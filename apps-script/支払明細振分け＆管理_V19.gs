/*************************************************
 * 支払明細振分け＆管理 V19（シンプル版）
 *
 * 決まりごと
 *  ・入力シート（計算用まとめ・貼付用・計算用・顧客マスタ など）には一切書き込まない
 *  ・自動トリガーなし。メニューのボタンを押したときだけ動く
 *  ・台帳は「支払月＋推薦者コード」で必ず1行
 *  ・B社支払額・手入力の調整は「【手入力】B社・調整」シートに入れる（台帳には直接入れない）
 *  ・おかしい行は書き換えずに「V19_確認」に一覧で出し、その行は払わない（保留）
 *
 * 動かし方
 *  ・MODE: 'TEST'（いまはこれ）
 *      V18 と並行で動かすためのモード。書き込むのは V19_ で始まるシートだけ。
 *      B社支払額は今の「支払管理台帳」G列から読む。
 *      結果は V19_台帳・V19_支払いまとめ・V19_確認・V19_比較（V18との差）に出る。
 *  ・MODE: 'LIVE'（切り替え後）
 *      「支払管理台帳」「支払いまとめ」を V19 で作る。B社支払額は【手入力】B社・調整 から読む。
 *      切り替えの前に、メニュー「B社・調整の入力シートを作る」を1回だけ押す。
 *
 * ② 推薦者ファイルへの反映・迷子契約のボタンは、当面 V18 のメニューを使う。
 *************************************************/

const V19 = {

  MODE: 'TEST',

  SOURCE_SHEET: '【手入力固定】計算用まとめ（永久保存版）',
  MASTER_SHEET: '【自動】推薦者コード管理_取込',
  LEDGER_SHEET: '支払管理台帳',
  SUMMARY_SHEET: '支払いまとめ',
  INPUT_SHEET: '【手入力】B社・調整',

  TEST_LEDGER_SHEET: 'V19_台帳',
  TEST_SUMMARY_SHEET: 'V19_支払いまとめ',
  CHECK_SHEET: 'V19_確認',
  COMPARE_SHEET: 'V19_比較',

  SOURCE_COLS: 20,
  SOURCE_ID_COL: 6,        // F
  SOURCE_AMOUNT_COL: 14,   // N
  SOURCE_MONTH_COL: 15,    // O
  SOURCE_SEQUENCE_COL: 21, // U
  SOURCE_ORIGINAL_RATE_COL: 28, // AB（V18が残した元の支払倍率。読むだけ）

  MASTER_START_ROW: 5,
  MASTER_NAME_COL: 2,      // B
  MASTER_CODE_COL: 3,      // C
  MASTER_LARGE_COL: 11,    // K
  MASTER_SMALL_COL: 12,    // L

  CLAWBACK_SHEET: '【自動】減額戻入',
  TRANSFER_SHEET: '【手入力】担当者変更',
  TRANSFER_SOURCE_ID: '1-Z8RxBMwXVVvOKcJ6C9UrLdeSmNxwRDZw466SAfxlRE',
  TRANSFER_SOURCE_SHEET: '担当者変更後',
  POLICY_SHEET: 'プランポリシー',
  ANNUAL_CAP_FROM: '2026.10',

  ADMIN_FEE: 5,
  NO_PAYOUT_IDS: ['1820'],

  /* 新しく見つかった減額戻入を【自動】減額戻入に追記するか（TESTでは追記しない＝V18が追記する） */
  WRITE_CLAWBACK: false
};

/* 実行中の受け渡し用 */
const V19_STATE = {};


/*************************************************
 * メニュー
 *************************************************/
function showPaymentMenuV19() {

  SpreadsheetApp.getUi()
    .createMenu('支払管理V19')
    .addItem('① 計算する（V19）', 'runPaymentV19')
    .addSeparator()
    .addItem('【切替時に1回】B社・調整の入力シートを作る', 'createInputSheetV19')
    .addToUi();
}


/* 開いたときに「支払管理V19」メニューを出す（1回だけ実行） */
function installPaymentMenuV19() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'showPaymentMenuV19')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('showPaymentMenuV19')
    .forSpreadsheet(ss)
    .onOpen()
    .create();

  showPaymentMenuV19();
}


/*************************************************
 * ① 計算する
 *************************************************/
function runPaymentV19() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const live = V19.MODE === 'LIVE';

  V19.WRITE_CLAWBACK = live;

  const calc = v19_calculate_(ss);

  const oldLedger = v19_readLedger_(ss.getSheetByName(V19.LEDGER_SHEET));

  const inputs = live ? v19_readInputSheet_(ss) : v19_inputsFromLedger_(oldLedger);

  const ledger = v19_buildLedger_(calc, inputs, oldLedger);

  const summary = v19_buildSummary_(ledger);

  if (live) {
    v19_backupOnce_(ss, V19.LEDGER_SHEET);
  }

  v19_writeLedger_(ss, live ? V19.LEDGER_SHEET : V19.TEST_LEDGER_SHEET, ledger);

  v19_writeSummary_(ss, live ? V19.SUMMARY_SHEET : V19.TEST_SUMMARY_SHEET, summary);

  v19_writeCheck_(ss, calc);

  let compareText = '';

  if (!live) {
    compareText = v19_writeCompare_(ss, ledger, summary, oldLedger);
  }

  v19_alert_(
    'V19 の計算が終わりました（' + (live ? '本番' : 'テスト：V19_ のシートだけに出力') + '）。\n\n' +
    '対象月：' + ledger.latestMonth + '\n' +
    '今回払出額の合計：$' + summary.totalPayout.toLocaleString() + '\n' +
    '支払保留・要確認：' + calc.checkRows.length + '件（V19_確認）\n' +
    compareText
  );
}


/*************************************************
 * 計算用まとめ → 契約ごとの今回支払額（読むだけ）
 *************************************************/
function v19_calculate_(ss) {

  const source = ss.getSheetByName(V19.SOURCE_SHEET);

  if (!source) {
    throw new Error(V19.SOURCE_SHEET + ' がありません。');
  }

  const lastRow = source.getLastRow();

  const all = source.getRange(1, 1, lastRow, V19.SOURCE_COLS).getValues();

  const monthDisplay = source.getRange(1, V19.SOURCE_MONTH_COL, lastRow, 1).getDisplayValues();

  const sequenceValues = source.getRange(1, V19.SOURCE_SEQUENCE_COL, lastRow, 1).getDisplayValues();

  const originalRates = source.getMaxColumns() >= V19.SOURCE_ORIGINAL_RATE_COL
    ? source.getRange(1, V19.SOURCE_ORIGINAL_RATE_COL, lastRow, 1).getValues()
    : [];

  const rowsInfo = [];

  all.slice(1).forEach((original, index) => {

    const row = original.slice(0, 20);

    const sequence = String(sequenceValues[index + 1][0] || '').trim();

    const sheetRate = row[12];

    const sheetAmount = row[13];

    /* AB列の元の倍率は「倍率@@行のキー」がこの行と一致するときだけ使う */
    const rowKey = v19_rateRowKey_(row, sequence);

    const savedCell = originalRates.length ? String(originalRates[index + 1][0] || '') : '';

    const savedMatch = savedCell.match(/^(.*?)@@(.*)$/);

    const savedRate = savedMatch && savedMatch[2] === rowKey ? savedMatch[1] : '';

    if (savedRate !== '' && !isNaN(Number(savedRate))) {
      row[12] = Number(savedRate);
      row[13] = Math.round(v19_num_(row[10]) * Number(savedRate) * 100) / 100;
    }

    const id = v19_id_(row[V19.SOURCE_ID_COL - 1]);

    if (!id) {
      return;
    }

    const month = v19_month_(monthDisplay[index + 1][0]);

    row[V19.SOURCE_MONTH_COL - 1] = month;

    rowsInfo.push({
      row: row,
      id: id,
      month: month,
      sequence: sequence,
      sheetRate: sheetRate,
      sheetAmount: sheetAmount,
      rowNumber: index + 2,
      originalNote: String(original[15] || '')
    });
  });

  const policyMap = v19_loadPolicyMap_(ss);

  v19_holdBrokenRows_(rowsInfo);

  v19_applyAnnualCap_(rowsInfo, policyMap, v19_loadTransferMap_(ss));

  v19_applyMinashiGuard_(rowsInfo, policyMap);

  v19_notePrepaidLevel_(rowsInfo, policyMap);

  v19_applyReductionClawback_(ss, rowsInfo, policyMap);

  const latestMonth = rowsInfo.reduce((latest, info) =>
    v19_monthIndex_(info.month) > v19_monthIndex_(latest) ? info.month : latest, '');

  /* 支払月＋推薦者コードごとのW社支払額 */
  const wByKey = {};

  rowsInfo.forEach(info => {

    if (!info.month) {
      return;
    }

    const key = info.month + '||' + info.id;

    wByKey[key] = (wByKey[key] || 0) + v19_num_(info.row[V19.SOURCE_AMOUNT_COL - 1]);
  });

  /* 最新月で、シートの今回支払額と V19 の支払額が違う行・保留の行（確認用） */
  const checkRows = [];

  rowsInfo.forEach(info => {

    if (!info.rowNumber || info.month !== latestMonth) {
      return;
    }

    const finalAmount = v19_num_(info.row[13]);

    const differs = Math.abs(finalAmount - v19_num_(info.sheetAmount)) >= 0.01;

    if (!info.hold && !differs) {
      return;
    }

    checkRows.push([
      info.rowNumber,
      info.month,
      info.id,
      String(info.row[0] || ''),
      String(info.row[2] || ''),
      String(info.row[11] || ''),
      info.sheetRate,
      info.row[12],
      v19_num_(info.sheetAmount),
      finalAmount,
      info.hold ? '支払保留' : 'V19の額で計算',
      String(info.row[15] || '')
    ]);
  });

  (V19_STATE.newClawbacks || []).forEach(record => {

    checkRows.push([
      '', v19_month_(record[0]), v19_id_(record[1]), String(record[2] || ''), String(record[4] || ''),
      String(record[13] || ''), '', '', '', v19_num_(record[11]),
      '戻入（新規・未記録）', String(record[12] || '')
    ]);
  });

  return {
    rowsInfo: rowsInfo,
    wByKey: wByKey,
    adjustNotes: v19_collectAdjustNotes_(rowsInfo),
    latestMonth: latestMonth,
    masterMap: v19_loadMaster_(ss),
    checkRows: checkRows
  };
}


/*************************************************
 * 推薦者コード管理（名前・グループ）
 *************************************************/
function v19_loadMaster_(ss) {

  const sheet = ss.getSheetByName(V19.MASTER_SHEET);

  const map = {};

  if (!sheet || sheet.getLastRow() < V19.MASTER_START_ROW) {
    return map;
  }

  sheet
    .getRange(V19.MASTER_START_ROW, 1, sheet.getLastRow() - V19.MASTER_START_ROW + 1, V19.MASTER_SMALL_COL)
    .getDisplayValues()
    .forEach(row => {

      const id = v19_id_(row[V19.MASTER_CODE_COL - 1]);

      if (!id || map[id]) {
        return;
      }

      map[id] = {
        name: String(row[V19.MASTER_NAME_COL - 1] || '').trim(),
        largeGroup: v19_cleanGroup_(row[V19.MASTER_LARGE_COL - 1]),
        smallGroup: v19_cleanGroup_(row[V19.MASTER_SMALL_COL - 1])
      };
    });

  return map;
}


/*************************************************
 * 今の支払管理台帳を読む（案内状況・支払状況などの手入力欄を引き継ぐため）
 *************************************************/
function v19_readLedger_(sheet) {

  const result = { byKey: {}, contactById: {}, rows: [] };

  if (!sheet || sheet.getLastRow() < 2) {
    return result;
  }

  const lastRow = sheet.getLastRow();

  const values = sheet.getRange(1, 1, lastRow, Math.max(20, sheet.getLastColumn())).getValues();

  const monthDisplay = sheet.getRange(1, 1, lastRow, 1).getDisplayValues();

  const header = values[0].map(value => String(value || '').trim());

  const find = (...names) => names.map(name => header.indexOf(name)).filter(index => index >= 0)[0];

  const c = {
    id: find('推薦者コード'),
    name: find('推薦者名'),
    large: find('大グループ'),
    small: find('小グループ'),
    w: find('W社支払額'),
    b: find('B社支払額', 'BANK社支払額'),
    carry: find('前月未払い繰越'),
    gross: find('総支払額'),
    action: find('対応'),
    contact: find('連絡グループ'),
    person: find('連絡先・担当', '連絡先・担当者'),
    guide: find('案内状況'),
    invoice: find('請求書'),
    status: find('支払状況'),
    date: find('支払日'),
    note: find('備考'),
    marker: find('管理種別')
  };

  const get = (row, index) => (index === undefined ? '' : row[index]);

  values.slice(1).forEach((row, index) => {

    const month = v19_month_(monthDisplay[index + 1][0]);

    const id = v19_id_(get(row, c.id));

    if (!month || !id) {
      return;
    }

    const record = {
      month: month,
      id: id,
      name: String(get(row, c.name) || ''),
      largeGroup: v19_cleanGroup_(get(row, c.large)),
      smallGroup: v19_cleanGroup_(get(row, c.small)),
      w: get(row, c.w),
      b: get(row, c.b),
      carry: get(row, c.carry),
      gross: get(row, c.gross),
      action: String(get(row, c.action) || ''),
      contact: String(get(row, c.contact) || ''),
      person: String(get(row, c.person) || ''),
      guide: String(get(row, c.guide) || ''),
      invoice: String(get(row, c.invoice) || ''),
      status: String(get(row, c.status) || ''),
      date: get(row, c.date),
      note: String(get(row, c.note) || ''),
      marker: String(get(row, c.marker) || '')
    };

    result.rows.push(record);

    const key = month + '||' + id;

    (result.byKey[key] || (result.byKey[key] = [])).push(record);

    if (record.contact || record.person) {
      result.contactById[id] = { contact: record.contact, person: record.person };
    }
  });

  return result;
}


/*************************************************
 * B社・調整の入力
 *   TEST：今の支払管理台帳のG列（B社支払額）と手動行をそのまま使う
 *   LIVE：【手入力】B社・調整 から読む
 * 戻り値：[{ month, id, kind: 'B社' | 'W社調整', amount, memo }]
 *************************************************/
function v19_inputsFromLedger_(oldLedger) {

  const inputs = [];

  oldLedger.rows.forEach(record => {

    const hasB = record.b !== '' && record.b !== null && record.b !== undefined;

    if (!hasB && record.marker !== 'MANUAL') {
      return;
    }

    inputs.push({
      month: record.month,
      id: record.id,
      kind: 'B社',
      amount: hasB ? v19_num_(record.b) : 0,
      memo: record.marker === 'MANUAL' ? record.note : ''
    });
  });

  return inputs;
}


/*
 * 【手入力】B社・調整 の列
 *   A 支払月 / B 推薦者コード / C 推薦者名 / D 大グループ / E 小グループ（C〜Eは式で自動表示）
 *   F 区分（B社／W社調整） / G 金額 / H メモ
 * 列は見出しの名前で探すので、列の並びが変わっても読める。
 */
const V19_INPUT_HEADER = [
  '支払月', '推薦者コード', '推薦者名（自動）', '大グループ（自動）', '小グループ（自動）',
  '区分（B社／W社調整）', '金額', 'メモ（台帳の備考に出ます）'
];


function v19_readInputSheet_(ss) {

  const sheet = ss.getSheetByName(V19.INPUT_SHEET);

  if (!sheet) {
    throw new Error(V19.INPUT_SHEET + ' がありません。メニュー「B社・調整の入力シートを作る」を先に押してください。');
  }

  if (sheet.getLastRow() < 2) {
    return [];
  }

  const lastRow = sheet.getLastRow();

  const lastCol = sheet.getLastColumn();

  const header = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(value => String(value || '').trim());

  const find = prefix => header.findIndex(value => value.indexOf(prefix) === 0);

  const c = {
    month: find('支払月'),
    id: find('推薦者コード'),
    kind: find('区分'),
    amount: find('金額'),
    memo: find('メモ')
  };

  if (c.month < 0 || c.id < 0 || c.amount < 0) {
    throw new Error(V19.INPUT_SHEET + ' の見出し（支払月・推薦者コード・金額）が見つかりません。1行目の見出しを確認してください。');
  }

  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const display = sheet.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();

  const inputs = [];

  values.forEach((row, index) => {

    const month = v19_month_(display[index][c.month]);

    const id = v19_id_(row[c.id]);

    if (!month || !id) {
      return;
    }

    const kind = c.kind >= 0 && String(row[c.kind] || '').trim() === 'W社調整' ? 'W社調整' : 'B社';

    inputs.push({
      month: month,
      id: id,
      kind: kind,
      amount: v19_num_(row[c.amount]),
      memo: c.memo >= 0 ? String(row[c.memo] || '').trim() : ''
    });
  });

  return inputs;
}


/* 【切替時に1回】今の支払管理台帳のB社支払額・手動行から入力シートを作る */
function createInputSheetV19() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (ss.getSheetByName(V19.INPUT_SHEET)) {
    v19_alert_(V19.INPUT_SHEET + ' はもうあります（上書きしません）。');
    return;
  }

  const inputs = v19_inputsFromLedger_(v19_readLedger_(ss.getSheetByName(V19.LEDGER_SHEET)));

  const sheet = ss.insertSheet(V19.INPUT_SHEET);

  const rows = Math.max(1000, inputs.length + 200);

  if (sheet.getMaxRows() < rows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
  }

  /* 支払月・推薦者コードは文字扱い（2026.10 が 2026.1 にならないように） */
  sheet.getRange(1, 1, rows, 2).setNumberFormat('@');

  sheet.getRange(1, 1, 1, V19_INPUT_HEADER.length).setValues([V19_INPUT_HEADER]);

  if (inputs.length > 0) {

    sheet.getRange(2, 1, inputs.length, 2).setValues(inputs.map(input => [input.month, input.id]));

    sheet.getRange(2, 6, inputs.length, 3).setValues(inputs.map(input => [input.kind, input.amount, input.memo]));
  }

  /* 推薦者名・大グループ・小グループは推薦者コード管理から自動表示（C2の式が下まで広がる。C〜E列には手で入力しない） */
  const master = "'" + V19.MASTER_SHEET + "'!";

  sheet.getRange(2, 3).setFormula(
    '=ARRAYFORMULA(IF(B2:B="","",LET(r,IFERROR(VLOOKUP(B2:B&"",{' +
    master + 'C5:C&"",' + master + 'B5:B,' + master + 'K5:K,' + master + 'L5:L},{2,3,4},FALSE),{"コードが推薦者コード管理にありません","",""}),IF(r&""="0","",r))))'
  );

  sheet.getRange(2, 7, rows - 1, 1).setNumberFormat('#,##0.00');

  sheet.getRange(1, 1, 1, V19_INPUT_HEADER.length).setFontWeight('bold').setBackground('#4472C4').setFontColor('#FFFFFF');

  sheet.getRange(1, 3, rows, 3).setBackground('#F2F2F2');

  sheet.getRange(1, 3, 1, 3).setBackground('#7F7F7F');

  sheet.setFrozenRows(1);

  v19_alert_(V19.INPUT_SHEET + ' を作りました（' + inputs.length + '件）。\n' +
    'これからは B社支払額・手入力の調整はこのシートに入れてください（台帳のG列には入れない）。\n\n' +
    '入れるのは A 支払月・B 推薦者コード・F 区分・G 金額・H メモ です。\n' +
    'C〜E（推薦者名・グループ）は自動で出るので、手で入力しないでください。');
}


/*************************************************
 * 台帳を作る（支払月＋推薦者コードで1行）
 *************************************************/
function v19_buildLedger_(calc, inputs, oldLedger) {

  const rows = {};

  const ensure = (month, id) => {

    const key = month + '||' + id;

    if (!rows[key]) {
      rows[key] = { key: key, month: month, id: id, w: 0, b: 0, hasSource: false, memos: [], wNotes: [] };
    }

    return rows[key];
  };

  Object.keys(calc.wByKey).forEach(key => {

    const parts = key.split('||');

    const row = ensure(parts[0], parts[1]);

    row.w += calc.wByKey[key];

    row.hasSource = true;
  });

  inputs.forEach(input => {

    const row = ensure(input.month, input.id);

    if (input.kind === 'W社調整') {
      row.w += input.amount;
      row.wNotes.push('W社調整 ' + input.amount + (input.memo ? '（' + input.memo + '）' : ''));
    } else {
      row.b += input.amount;
      if (input.memo) {
        row.memos.push(input.memo);
      }
    }
  });

  let latestMonth = '';

  Object.values(rows).forEach(row => {
    if (v19_monthKey_(row.month) > v19_monthKey_(latestMonth)) {
      latestMonth = row.month;
    }
  });

  const latestKey = v19_monthKey_(latestMonth);

  /* 手入力欄は今の台帳から引き継ぐ（同じ支払月＋コードの行が複数あればまとめる） */
  const carryNotes = [
    '前月までの未払い繰越のみ（今月の新規発生なし）',
    '今月はB社分のみ（W社の新規発生なし）'
  ];

  const manage = (month, id) => {

    const olds = (oldLedger.byKey[month + '||' + id] || []).slice()
      .sort((a, b) => (a.marker === 'AUTO' ? 0 : 1) - (b.marker === 'AUTO' ? 0 : 1));

    const pick = field => {
      const found = olds.find(record => String(record[field] || '').trim() !== '');
      return found ? found[field] : '';
    };

    const paid = olds.find(record => v19_isPaid_(record.status));

    const noPayment = olds.find(record => v19_isNoPayment_(record.status));

    const notes = [];

    olds.forEach(record => {

      String(v19_stripAdjustNote_(record.note) || '').split(' / ').forEach(part => {

        const text = part.trim();

        if (text && carryNotes.indexOf(text) < 0 && notes.indexOf(text) < 0) {
          notes.push(text);
        }
      });
    });

    const contact = oldLedger.contactById[id] || {};

    return {
      contact: pick('contact') || contact.contact || '',
      person: pick('person') || contact.person || '',
      guide: pick('guide') || '未案内',
      invoice: pick('invoice') || '未',
      status: paid ? paid.status : (noPayment ? noPayment.status : (pick('status') || '未払い')),
      date: pick('date'),
      notes: notes
    };
  };

  /* 繰越（W社分だけ。B社分は翌月のBank社の額に前月分が含まれて届くので繰り越さない） */
  const byId = {};

  Object.values(rows).forEach(row => {
    (byId[row.id] || (byId[row.id] = [])).push(row);
  });

  Object.keys(byId).forEach(id => {

    const internal = V19.NO_PAYOUT_IDS.indexOf(String(id)) >= 0;

    const list = byId[id].sort((a, b) => v19_monthKey_(a.month) - v19_monthKey_(b.month));

    let outstanding = 0;

    list.forEach(row => {

      Object.assign(row, manage(row.month, id));

      const isPast = v19_monthKey_(row.month) < latestKey;

      const paid = v19_isPaid_(row.status);

      const noPayment = v19_isNoPayment_(row.status);

      row.carry = noPayment || internal ? 0 : v19_cents_(outstanding);

      row.gross = noPayment ? 0 : v19_cents_(row.w + row.b + row.carry);

      row.action = v19_action_(row, isPast, paid, noPayment, internal);

      outstanding = paid || noPayment || internal ? 0 : outstanding + row.w;
    });

    /* 最新月に行がなく、W社の未払いが残っている人は「繰越のみ」の行を作る */
    const last = list[list.length - 1];

    if (!internal && v19_monthKey_(last.month) < latestKey && Math.abs(v19_cents_(outstanding)) >= 0.01) {

      const row = ensure(latestMonth, id);

      Object.assign(row, manage(latestMonth, id));

      row.carryOnly = true;

      row.carry = v19_cents_(outstanding);

      row.gross = row.carry;

      row.action = v19_action_(row, false, false, false, false);
    }
  });

  const output = Object.values(rows).map(row => {

    const master = calc.masterMap[row.id] || {};

    const olds = oldLedger.byKey[row.key] || [];

    const notes = (row.notes || []).slice();

    row.memos.concat(row.wNotes).forEach(text => {
      if (notes.indexOf(text) < 0) {
        notes.push(text);
      }
    });

    if (row.carryOnly && notes.length === 0) {
      notes.push(carryNotes[0]);
    } else if (!row.hasSource && Math.abs(row.b) > 0.000001 && Math.abs(row.w) < 0.000001 &&
      row.month === latestMonth && notes.length === 0) {
      notes.push(carryNotes[1]);
    }

    return {
      month: row.month,
      id: row.id,
      name: master.name || (olds[0] ? olds[0].name : ''),
      /* 推薦者コード管理にグループが無いときは今の台帳のグループを使う */
      largeGroup: master.largeGroup || (olds.find(record => record.largeGroup) || {}).largeGroup || '',
      smallGroup: master.smallGroup || (olds.find(record => record.smallGroup) || {}).smallGroup || '',
      w: v19_cents_(row.w),
      b: v19_cents_(row.b),
      carry: row.carry,
      gross: row.gross,
      action: row.action,
      contact: row.contact,
      person: row.person,
      guide: row.guide,
      invoice: row.invoice,
      status: row.status,
      date: row.date,
      note: v19_mergeAdjustNote_(notes.join(' / '), calc.adjustNotes[row.key]),
      marker: row.hasSource ? 'AUTO' : (row.carryOnly ? 'CARRY' : 'MANUAL')
    };
  });

  output.sort(v19_compare_);

  return { rows: output, latestMonth: latestMonth };
}


/* 対応（V18と同じ判定） */
function v19_action_(row, isPast, paid, noPayment, internal) {

  const gross = row.gross;

  if (paid) {
    return '✓ 支払済';
  }

  if (noPayment) {
    return '支払なし';
  }

  if (internal) {
    return '弊社分（計算のみ・支払なし）';
  }

  if (Math.abs(row.carry) > 0.000001) {
    return '⚠ 繰越あり';
  }

  if (isPast && Math.abs(row.w) > 0.000001) {
    return '⚠ 未払い・繰越';
  }

  if (isPast && Math.abs(row.b) > 0.000001) {
    return 'B社分は翌月分に含む（繰越なし）';
  }

  if (!isPast && gross < -0.000001) {
    return '次回繰越';
  }

  if (!isPast && gross > 0.000001 && Math.floor(gross + 0.000001) <= V19.ADMIN_FEE) {
    return '次回繰越';
  }

  if (!isPast && gross > 0.000001) {
    return '今回支払';
  }

  return '支払なし';
}


/*************************************************
 * 支払いまとめ（推薦者ごとの今回払出額）
 *   合計を1回だけ切り捨て → $5を引く。$5以下・マイナスは払わず次回繰越。
 *   弊社コード（1820）は0。最新月に行がない人は0。
 *************************************************/
function v19_buildSummary_(ledger) {

  const byId = {};

  ledger.rows.forEach(row => {
    (byId[row.id] || (byId[row.id] = [])).push(row);
  });

  const months = [...new Set(ledger.rows.map(row => row.month))]
    .sort((a, b) => v19_monthKey_(a) - v19_monthKey_(b));

  const ids = Object.keys(byId).sort((a, b) => v19_codeKey_(a) - v19_codeKey_(b));

  let totalPayout = 0;

  const list = ids.map(id => {

    const rows = byId[id].sort((a, b) => v19_monthKey_(a.month) - v19_monthKey_(b.month));

    const latest = rows[rows.length - 1];

    const notice = v19_payout_(latest.gross);

    const internal = V19.NO_PAYOUT_IDS.indexOf(String(id)) >= 0;

    const payout = internal || latest.month !== ledger.latestMonth ? 0 : notice.payout;

    totalPayout += Math.max(0, payout);

    const byMonth = {};

    rows.forEach(row => {
      byMonth[row.month] = row.gross;
    });

    return {
      id: id,
      name: latest.name,
      byMonth: byMonth,
      latest: latest,
      payout: payout
    };
  });

  return { months: months, list: list, totalPayout: totalPayout };
}


function v19_payout_(value) {

  const total = v19_cents_(value);

  const gross = total >= 0 ? Math.floor(total + 0.000001) : Math.ceil(total - 0.000001);

  if (gross > 0 && gross <= V19.ADMIN_FEE) {
    return { gross: gross, fee: 0, payout: 0 };
  }

  const fee = gross > 0 ? V19.ADMIN_FEE : 0;

  return { gross: gross, fee: fee, payout: gross - fee };
}


/*************************************************
 * 書き込み（V19 が作るシートだけ）
 *************************************************/
function v19_sheet_(ss, name) {

  let sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
  }

  return sheet;
}


function v19_replaceValues_(sheet, output, width) {

  if (sheet.getMaxRows() < output.length + 1) {
    sheet.insertRowsAfter(sheet.getMaxRows(), output.length + 1 - sheet.getMaxRows());
  }

  if (sheet.getMaxColumns() < width) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  }

  if (sheet.getLastRow() > 0) {
    sheet.getRange(1, 1, sheet.getLastRow(), Math.max(width, sheet.getLastColumn())).clearContent();
  }

  sheet.getRange(1, 1, output.length, width).setValues(output);

  sheet.setFrozenRows(1);

  sheet.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#4472C4').setFontColor('#FFFFFF');
}


const V19_LEDGER_HEADER = [
  '支払月', '推薦者コード', '推薦者名', '大グループ', '小グループ',
  'W社支払額', 'B社支払額', '前月未払い繰越', '総支払額', '対応',
  '連絡グループ', '連絡先・担当', '案内状況', '請求書', '支払状況',
  '支払日', '備考', '最終更新', '管理種別', '手動保護'
];


function v19_writeLedger_(ss, name, ledger) {

  const sheet = v19_sheet_(ss, name);

  const now = new Date();

  const output = [V19_LEDGER_HEADER].concat(ledger.rows.map(row => [
    row.month, row.id, row.name, row.largeGroup, row.smallGroup,
    row.w, row.b, row.carry, row.gross, row.action,
    row.contact, row.person, row.guide, row.invoice, row.status,
    row.date, row.note, now, row.marker, ''
  ]));

  sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), output.length), 1).setNumberFormat('@');

  v19_replaceValues_(sheet, output, V19_LEDGER_HEADER.length);

  sheet.getRange(2, 6, Math.max(1, output.length - 1), 4).setNumberFormat('#,##0.00');
}


function v19_writeSummary_(ss, name, summary) {

  const sheet = v19_sheet_(ss, name);

  const header = ['推薦者コード', '推薦者名'].concat(summary.months, ['最新月', '今回払出額', '対応']);

  const output = [header].concat(summary.list.map(item => [item.id, item.name]
    .concat(summary.months.map(month => item.byMonth[month] !== undefined ? item.byMonth[month] : ''))
    .concat([item.latest.month, item.payout, item.latest.action])));

  sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), output.length), header.length).setNumberFormat('@');

  sheet.getRange(2, 3, Math.max(1, output.length - 1), summary.months.length).setNumberFormat('#,##0.00');

  sheet.getRange(2, header.length - 1, Math.max(1, output.length - 1), 1).setNumberFormat('#,##0');

  v19_replaceValues_(sheet, output, header.length);
}


function v19_writeCheck_(ss, calc) {

  const header = [
    '計算用まとめの行', '支払月', '推薦者コード', 'プラン番号', '商品コード', '支払区分',
    'シートの支払倍率', 'V19の支払倍率', 'シートの今回支払額', 'V19の支払額', '扱い', '理由'
  ];

  const output = [header].concat(calc.checkRows.length ? calc.checkRows : [['', '', '', '', '', '', '', '', '', '', '確認が必要な行はありません', '']]);

  v19_replaceValues_(v19_sheet_(ss, V19.CHECK_SHEET), output, header.length);
}


/* TEST：V18 の支払管理台帳・支払いまとめとの比較（最新月） */
function v19_writeCompare_(ss, ledger, summary, oldLedger) {

  const old = {};

  oldLedger.rows.forEach(record => {

    if (record.month !== ledger.latestMonth) {
      return;
    }

    const item = old[record.id] || (old[record.id] = { w: 0, b: 0, carry: 0 });

    item.w += v19_num_(record.w);

    item.b += v19_num_(record.b);

    if (Math.abs(v19_num_(record.carry)) > Math.abs(item.carry)) {
      item.carry = v19_num_(record.carry);
    }
  });

  const oldPayout = {};

  const summarySheet = ss.getSheetByName(V19.SUMMARY_SHEET);

  if (summarySheet && summarySheet.getLastRow() >= 2) {

    const values = summarySheet.getRange(1, 1, summarySheet.getLastRow(), summarySheet.getLastColumn()).getValues();

    const codeCol = values[0].indexOf('推薦者コード');

    const payCol = values[0].indexOf('今回払出額');

    values.slice(1).forEach(row => {
      if (codeCol >= 0 && payCol >= 0) {
        oldPayout[v19_id_(row[codeCol])] = v19_num_(row[payCol]);
      }
    });
  }

  const now = {};

  ledger.rows.forEach(row => {
    if (row.month === ledger.latestMonth) {
      now[row.id] = row;
    }
  });

  const payout = {};

  summary.list.forEach(item => {
    payout[item.id] = item.payout;
  });

  const ids = [...new Set(Object.keys(old).concat(Object.keys(now)))].sort((a, b) => v19_codeKey_(a) - v19_codeKey_(b));

  const header = [
    '推薦者コード', '推薦者名',
    'V18 W社', 'V19 W社', 'V18 B社', 'V19 B社', 'V18 繰越', 'V19 繰越', 'V18 総支払額', 'V19 総支払額',
    'V18 今回払出額', 'V19 今回払出額', '結果'
  ];

  let diffCount = 0;

  const output = [header].concat(ids.map(id => {

    const a = old[id] || { w: 0, b: 0, carry: 0 };

    const b = now[id] || { w: 0, b: 0, carry: 0, gross: 0, name: '' };

    const oldGross = v19_cents_(a.w + a.b + a.carry);

    const same =
      Math.abs(v19_cents_(a.w) - b.w) < 0.01 &&
      Math.abs(v19_cents_(a.b) - b.b) < 0.01 &&
      Math.abs(v19_cents_(a.carry) - b.carry) < 0.01 &&
      Math.abs((oldPayout[id] || 0) - (payout[id] || 0)) < 0.01;

    if (!same) {
      diffCount++;
    }

    return [
      id, b.name || ((oldLedger.byKey[ledger.latestMonth + '||' + id] || [])[0] || {}).name || '',
      v19_cents_(a.w), b.w, v19_cents_(a.b), b.b, v19_cents_(a.carry), b.carry, oldGross, b.gross || 0,
      oldPayout[id] || 0, payout[id] || 0, same ? '一致' : '差あり'
    ];
  }));

  v19_replaceValues_(v19_sheet_(ss, V19.COMPARE_SHEET), output, header.length);

  return 'V18 との比較（' + ledger.latestMonth + '）：' + (ids.length - diffCount) + '人一致・' + diffCount + '人差あり（V19_比較）';
}


/* LIVE に切り替えて最初の1回だけ、台帳をまるごとコピーしておく */
function v19_backupOnce_(ss, name) {

  const backupName = '【バックアップ】' + name + '_V19切替前';

  const sheet = ss.getSheetByName(name);

  if (!sheet || ss.getSheetByName(backupName)) {
    return;
  }

  sheet.copyTo(ss).setName(backupName);
}


/*************************************************
 * 小物
 *************************************************/

/* AB列の元の支払倍率がどの行のものかを確かめるキー（V18と同じ） */
function v19_rateRowKey_(row, sequence) {
  return [row[0], row[2], row[5], sequence, row[11], row[3], v19_num_(row[10])]
    .map(value => String(value === null || value === undefined ? '' : value).replace(/[\s　]/g, ''))
    .join('|');
}


function v19_cleanGroup_(value) {

  const text = String(value === null || value === undefined ? '' : value).trim();

  return text === '0' ? '' : text;
}


function v19_codeKey_(value) {

  const num = Number(String(value).replace(/[^\d.-]/g, ''));

  return isNaN(num) ? 999999999 : num;
}


function v19_compare_(a, b) {

  const month = v19_monthKey_(a.month) - v19_monthKey_(b.month);

  if (month !== 0) {
    return month;
  }

  const groupA = String(a.smallGroup || '');

  const groupB = String(b.smallGroup || '');

  if (!groupA && groupB) {
    return 1;
  }

  if (groupA && !groupB) {
    return -1;
  }

  const group = groupA.localeCompare(groupB, 'ja');

  if (group !== 0) {
    return group;
  }

  return v19_codeKey_(a.id) - v19_codeKey_(b.id);
}



/*************************************************
 * ここから下は V18.9 の計算部分をそのまま使っている（名前だけ v19_ に変更・シートへの書き込みなし）
 *************************************************/

function v19_alert_(message) {

  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (error) {
    console.log(message);
  }
}



function v19_applyMinashiGuard_(rowsInfo, policyMap) {

  const AMOUNT = V19.SOURCE_AMOUNT_COL - 1;   // N
  const RATE = AMOUNT - 1;                            // M 支払倍率
  const KUBUN = 11;                                   // L 支払区分
  const NOTE = 15;                                    // P 備考①

  const targets = rowsInfo
    .filter(info =>
      info.month &&
      String(info.row[KUBUN] || '').trim() === 'みなし' &&
      !info.levelPay &&
      v19_num_(info.row[3]) < 2 &&
      v19_num_(info.row[AMOUNT]) > 0
    )
    .map((info, order) => ({ info: info, order: order }))
    .sort((a, b) => {
      const diff = v19_monthIndex_(a.info.month) - v19_monthIndex_(b.info.month);
      return diff !== 0 ? diff : a.order - b.order;
    });

  /*
   * ★V18.9：プラン番号＋支払対象者が同じで、
   * シーケンス（U列）が両方入っていればシーケンスで、
   * どちらかが空欄なら商品コードで同じ契約かを判定する。
   * 判定の理由は備考①に書く（元データのP列にも反映）。
   */

  /* 月ごと・プランごとに、みなし行に出てくるシーケンス */
  const sequencesByMonthPlan = {};

  rowsInfo.forEach(info => {

    if (!info.month || String(info.row[KUBUN] || '').trim() !== 'みなし') {
      return;
    }

    const key = v19_monthIndex_(info.month) + '||' +
      String(info.row[0] || '').trim() + '||' + info.id;

    (sequencesByMonthPlan[key] || (sequencesByMonthPlan[key] = new Set()))
      .add(info.sequence || '');
  });

  const fmt = value => {
    const num = Math.round(v19_num_(value) * 100) / 100;
    return String(num);
  };

  const paidByPlan = {};

  targets.forEach(item => {

    const info = item.info;

    const plan = String(info.row[0] || '').trim();

    const planKey = plan + '||' + info.id;

    const product = String(info.row[2] || '').trim();

    const sequence = info.sequence || '';

    const contribution = v19_num_(info.row[4]);   // E 拠出金額

    const amount = v19_num_(info.row[AMOUNT]);

    const index = v19_monthIndex_(info.month);

    const history = paidByPlan[planKey] || (paidByPlan[planKey] = []);

    const recent = history.filter(record =>
      index > record.index && index - record.index < 12
    );

    const sameNumbers = record =>
      record.product === product &&
      Math.abs(record.contribution - contribution) < 0.005 &&
      Math.abs(record.amount - amount) < 0.005;

    let reason = '';

    /*
     * ⓪ シーケンスの付け間違い（発効日で判定）：
     * 1年目の行なのに、そのシーケンスはプランポリシーの発効日では2年目以降の契約
     * （例：ライダー1は2024年発効・ライダー2が2026年発効なのに、1年目の行がライダー1）。
     * 違うシーケンスで払うと過払いになるため支払を保留する（2026.10以降の月だけ）。
     */
    if (sequence && policyMap && index >= v19_monthIndex_(V19.ANNUAL_CAP_FROM)) {

      const policy = policyMap[plan + '||' + v19_sequenceKey_(sequence)];

      const issue = policy && policy.issue;

      if (issue) {

        const elapsed = index - (issue.getFullYear() * 12 + issue.getMonth() + 1);

        if (elapsed >= 12) {

          const year = Math.floor(elapsed / 12) + 1;

          const others = Object.keys(policyMap)
            .filter(key => key.indexOf(plan + '||') === 0 && policyMap[key].product === product && policyMap[key].issue &&
              index - (policyMap[key].issue.getFullYear() * 12 + policyMap[key].issue.getMonth() + 1) < 12)
            .map(key => key.split('||')[1]);

          reason = 'シーケンス要確認：この行は契約1年目（期間1）だが、シーケンス「' + sequence +
            '」はプランポリシーでは発効日' + Utilities.formatDate(issue, Session.getScriptTimeZone(), 'yyyy/M/d') +
            '（' + year + '年目）の契約のため、シーケンスの付け間違いの可能性' +
            (others.length ? '（1年目の' + product + 'は「' + others.join('・') + '」）' : '') +
            ' → 過払いを防ぐため今回は支払保留。U列のシーケンスを直して①を押し直してください';
        }
      }
    }

    /* ① プラン番号＋シーケンスが同じ（シーケンス空欄なら商品コード） */
    const bySequence = reason ? null : recent.find(record =>
      record.sequence && sequence
        ? record.sequence === sequence
        : record.product === product
    );

    if (bySequence) {

      reason = bySequence.sequence && sequence
        ? bySequence.month + 'に支払済（プラン番号＋シーケンス「' + sequence +
          '」が同じ）→ みなし年払いは12か月に1回のため今回は支払対象外'
        : bySequence.month + 'に支払済（シーケンスが空欄のため、プラン番号＋商品コード「' +
          product + '」で照合）→ みなし年払いは12か月に1回のため今回は支払対象外';
    }

    /* ② 同じ月に全く同じ行が2回 */
    if (!reason) {

      const duplicate = history.find(record =>
        record.index === index &&
        record.sequence === sequence &&
        sameNumbers(record)
      );

      if (duplicate) {
        reason = '同じ月（' + info.month + '）に全く同じ行（プラン番号・シーケンス・商品・拠出金額・支払額）が' +
          '2回あるため、2行目は支払対象外';
      }
    }

    /*
     * ③ シーケンスの付け間違い：
     * 初めて出てきたシーケンス名だが、商品・拠出金額・支払額が
     * 12か月以内に支払済の別シーケンスと全く同じで、
     * しかも今月そのシーケンスの行が無い → 同じ契約と判断。
     */
    if (!reason && sequence) {

      const monthSequences =
        sequencesByMonthPlan[index + '||' + planKey] || new Set();

      const mislabel = recent.find(record =>
        record.sequence &&
        record.sequence !== sequence &&
        !monthSequences.has(record.sequence) &&
        sameNumbers(record) &&
        !history.some(other => other.sequence === sequence)
      );

      if (mislabel) {
        reason = 'シーケンスは「' + sequence + '」だが、商品' + product +
          '・拠出金額' + fmt(contribution) + '・支払額' + fmt(amount) +
          'が' + mislabel.month + 'に支払済の「' + mislabel.sequence +
          '」と全く同じで、今月「' + mislabel.sequence +
          '」の行が無いため、同じ契約のシーケンス付け間違いと判断 → 今回は支払対象外';
      }
    }

    if (reason) {

      info.row[RATE] = 0;

      info.row[AMOUNT] = 0;

      info.row[NOTE] = reason;

      info.noteChanged = true;

      return;
    }

    /* 同じプラン番号は支払済だが、別のシーケンスとして新規に支払う場合 */
    if (recent.length > 0) {

      const paidSequences = [...new Set(recent.map(record =>
        record.sequence || record.product
      ))].join('・');

      info.row[NOTE] = '今回支払い対象（みなし年払い）：プラン番号は' +
        recent[0].month + 'に支払済（' + paidSequences + '）だが、シーケンス「' +
        (sequence || product) + '」はこれまで支払っていないため、別の契約として新規に支払' +
        (recent.some(sameNumbers)
          ? '（拠出金額・支払額が同じ支払済の行は今月も別に出ているため、付け間違いではないと判断）'
          : '（拠出金額・支払額も支払済の行と一致しない）');

      info.noteChanged = true;

    } else {

      /* 初めての支払い：備考①が空欄か定型文のときだけ理由を書く */
      const currentNote = String(info.row[NOTE] || '').trim();

      if (info.capNote) {

        info.row[NOTE] = info.capNote;

        info.noteChanged = true;

      } else if (!currentNote || currentNote.indexOf('今回支払い対象（みなし年払い）') === 0) {

        info.row[NOTE] = '今回支払い対象（みなし年払い）：過去12か月に同じプラン番号の支払いがないため、初めての支払い';

        info.noteChanged = true;
      }
    }

    history.push({
      index: index,
      month: info.month,
      product: product,
      sequence: sequence,
      contribution: contribution,
      amount: amount
    });
  });
}



function v19_loadPolicyMap_(ss) {

  const map = {};

  const sheet = ss.getSheetByName(V19.POLICY_SHEET);

  if (!sheet || sheet.getLastRow() < 5) {
    return map;
  }

  const values = sheet
    .getRange(4, 1, sheet.getLastRow() - 3, sheet.getLastColumn())
    .getDisplayValues();

  const header = values[0].map(value => String(value || '').trim());

  const col = name => header.indexOf(name);

  const c = {
    plan: col('プラン番号'),
    sequence: col('シーケンス'),
    frequency: col('支払頻度'),
    annual: col('年間拠出金'),
    lump: col('一括払い'),
    productName: col('商品名'),
    status: col('状態'),
    lastPaid: col('最終の支払済日'),
    group: col('商品グループ'),
    issue: col('発効日'),
    introCode: col('イントロデューサーコード'),
    introName: col('イントロデューサー名')
  };

  if (c.plan < 0 || c.sequence < 0 || c.annual < 0) {
    return map;
  }

  values.slice(1).forEach(row => {

    const plan = String(row[c.plan] || '').trim();

    if (!plan) {
      return;
    }

    map[plan + '||' + v19_sequenceKey_(row[c.sequence])] = {
      frequency: c.frequency >= 0 ? String(row[c.frequency] || '').trim() : '',
      annual: v19_num_(String(row[c.annual] || '').replace(/[^0-9.\-]/g, '')),
      lump: c.lump >= 0 ? v19_num_(String(row[c.lump] || '').replace(/[^0-9.\-]/g, '')) : 0,
      product: c.productName >= 0 ? String(row[c.productName] || '').split(' - ')[0].trim() : '',
      status: c.status >= 0 ? String(row[c.status] || '').trim() : '',
      lastPaid: c.lastPaid >= 0 ? v19_parseDate_(row[c.lastPaid]) : null,
      group: c.group >= 0 ? String(row[c.group] || '').trim() : '',
      issue: c.issue >= 0 ? v19_parseDate_(row[c.issue]) : null,
      introCode: c.introCode >= 0 ? String(row[c.introCode] || '').trim() : '',
      introName: c.introName >= 0 ? String(row[c.introName] || '').trim() : ''
    };
  });

  /* A1 の日付＝プランポリシーを貼り付けた日（無ければ今日） */
  const asOf = v19_parseDate_(sheet.getRange(1, 1).getDisplayValue()) || new Date();

  Object.defineProperty(map, '__asOf', { value: asOf, enumerable: false });

  return map;
}



function v19_parseDate_(value) {

  if (value instanceof Date) {
    return value;
  }

  const text = String(value || '').trim();

  let m = text.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);

  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  m = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);

  if (m) {
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  }

  return null;
}



function v19_sequenceKey_(value) {
  return String(value || '')
    .replace(/[\s　]/g, '')
    .replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xFEE0))
    .replace(/ライダ[-ー－‐]?/g, 'ライダー');
}



function v19_applyReductionClawback_(ss, rowsInfo, policyMap) {

  const AMOUNT = V19.SOURCE_AMOUNT_COL - 1;   // N

  const GRACE_DAYS = 90;

  const header = [
    '検出月', '推薦者コード', 'プラン番号', 'シーケンス', '商品コード',
    'みなし支払月', 'みなし支払額', '実質紹介料率', '変更前の年間拠出額',
    '変更後の年間拠出額', '残り月数', '金額', '理由', '区分', '対象行'
  ];

  /* ★V19：記録シートは読むだけ（新しく見つかった戻入は V19.WRITE_CLAWBACK が true のときだけ追記） */
  const sheet = ss.getSheetByName(V19.CLAWBACK_SHEET);

  const lastRow = sheet ? sheet.getLastRow() : 0;

  const records = lastRow >= 2
    ? sheet.getRange(2, 1, lastRow - 1, header.length).getDisplayValues()
    : [];

  const latestMonth = rowsInfo.reduce((latest, info) =>
    v19_monthIndex_(info.month) > v19_monthIndex_(latest) ? info.month : latest, '');

  if (!latestMonth) {
    return;
  }

  const latestIndex = v19_monthIndex_(latestMonth);

  const asOf = policyMap.__asOf || new Date();

  const money = value => v19_num_(String(value).replace(/[^0-9.\-]/g, ''));

  const recordKey = (id, plan, sequence, payMonth) =>
    [v19_id_(id), String(plan || '').trim(), v19_sequenceKey_(sequence), v19_month_(payMonth)].join('||');

  /* 契約ごとの戻入（層）と返金 */
  const layersByKey = {};

  const refundedByRow = {};

  const transferAdjusted = {};

  records.forEach((record, index) => {

    const rowNumber = index + 2;

    if (record[13] === '担当者変更調整') {
      transferAdjusted[recordKey(record[1], record[2], record[3], record[5])] = true;
      return;
    }

    if (record[13] === '再開返金') {
      refundedByRow[record[14]] = (refundedByRow[record[14]] || 0) + money(record[11]);
      return;
    }

    const key = recordKey(record[1], record[2], record[3], record[5]);

    (layersByKey[key] || (layersByKey[key] = [])).push({
      rowNumber: String(rowNumber),
      before: money(record[8]),
      after: money(record[9]),
      amount: Math.abs(money(record[11]))
    });
  });

  const additions = [];

  rowsInfo.forEach(info => {

    const row = info.row;

    if (!info.month || String(row[11] || '').trim() !== 'みなし') {
      return;
    }

    if (info.levelPay || v19_num_(row[3]) >= 2) {
      return;   // 平準（2年目以降）は前払いしていないので戻入なし
    }

    let paid = v19_num_(row[AMOUNT]);

    const rate = v19_rate_(row[9]);   // J 実質紹介料率（0.25 でも "25%" でも可）

    const product = String(row[2] || '').trim();

    if (paid <= 0 || rate <= 0 || /^(FIFR|PLAT|ACS)/i.test(product)) {
      return;
    }

    const plan = String(row[0] || '').trim();

    let coverMonths = info.coverMonths || 12;

    /*
     * 担当者変更の契約を、支払済の過去月に×12で払っていた分の調整（1回だけ）。
     * 正しい額 ＝ 1回分の紹介料 × 弊社分の月数（1年目が終わっていれば×1）
     */
    if (info.pastTransferCover !== undefined) {

      coverMonths = info.pastTransferCover;

      const commission = v19_num_(row[10]);

      const correct = Math.round(commission * Math.max(1, coverMonths) * 100) / 100;

      const over = Math.round((paid - correct) * 100) / 100;

      const adjustKey = recordKey(info.id, plan, info.sequence, info.month);

      if (over >= 1 && !transferAdjusted[adjustKey]) {

        additions.push([
          latestMonth, info.id, plan, info.sequence || '', product,
          info.month, paid, Math.round(rate * 10000) / 100 + '%',
          '', '', coverMonths, -over,
          '担当者変更の契約（1年目のうち弊社分は' + coverMonths + 'か月）を' + info.month +
          'に×12で支払っていたため、正しい額' + correct + 'との差額を戻入',
          '担当者変更調整', ''
        ]);

        transferAdjusted[adjustKey] = true;
      }

      if (coverMonths <= 0) {
        return;   // 1年目は他社で終わっている＝平準なので、ほかの戻入はなし
      }

      paid = Math.min(paid, correct);
    }

    const elapsed = latestIndex - v19_monthIndex_(info.month);

    const remaining = coverMonths - elapsed;

    if (elapsed < 0 || remaining <= 0) {
      return;   // 対象期間を過ぎたもの
    }

    let policy = policyMap[plan + '||' + v19_sequenceKey_(info.sequence)];

    if (!policy && !info.sequence) {

      const candidates = Object.keys(policyMap)
        .filter(key => key.indexOf(plan + '||') === 0)
        .map(key => policyMap[key])
        .filter(item => item.product === product);

      policy = candidates.length === 1 ? candidates[0] : null;
    }

    if (!policy) {
      return;
    }

    const status = policy.status || '';

    const overdueDays = policy.lastPaid
      ? Math.floor((asOf - policy.lastPaid) / 86400000)
      : 0;

    const stopped =
      /解約|失効|払込済/.test(status) ||
      (/期間経過/.test(status) && overdueDays > GRACE_DAYS);

    const current = stopped ? 0 : policy.annual;

    if (!stopped && policy.annual <= 0) {
      return;
    }

    if (elapsed === 0 && !stopped) {
      return;   // 支払った月の減額は次の月に判定（解約・停止は同じ月でも戻入）
    }

    const key = recordKey(info.id, plan, info.sequence, info.month);

    const basis = paid / rate * 12 / coverMonths;

    const layers = layersByKey[key] || [];

    /* 今まだ引いたままの分を差し引いた「今の基準」 */
    const reducedNow = layers.reduce((sum, layer) => {
      const refunded = refundedByRow[layer.rowNumber] || 0;
      const keep = layer.amount > 0 ? 1 - Math.min(1, refunded / layer.amount) : 0;
      return sum + (layer.before - layer.after) * keep;
    }, 0);

    const effective = basis - reducedNow;

    const base = [
      latestMonth, info.id, plan, info.sequence || '', product,
      info.month, paid, Math.round(rate * 10000) / 100 + '%'
    ];

    const reasonStop = stopped
      ? (/期間経過/.test(status)
        ? '払込が' + overdueDays + '日止まっている（最終の支払済日から90日超・有効（期間経過））ため（年間拠出0）'
        : '契約が「' + status + '」になったため（年間拠出0）')
      : '';

    /* ① 下がった → 戻入 */
    if (current < effective * 0.99) {

      const amount = Math.round((effective - current) * rate * remaining / 12 * 100) / 100;

      if (amount >= 1) {

        additions.push(base.concat([
          Math.round(effective * 100) / 100, current, remaining, -amount,
          (reasonStop || '年間拠出額が' + Math.round(effective * 100) / 100 + '→' + current + 'に減額。') +
          'みなし年払い（' + info.month + '支払）の残り' + remaining + 'か月分を戻入',
          '戻入', ''
        ]));
      }

      return;
    }

    /* ② 戻った（払込再開・増額）→ 引いた分を返金（新しく引いた順に戻す） */
    if (current > effective * 1.01 && layers.length > 0) {

      layers
        .slice()
        .sort((a, b) => a.after - b.after)
        .forEach(layer => {

          const span = layer.before - layer.after;

          if (span <= 0) {
            return;
          }

          const restored = Math.max(0, Math.min(current, layer.before) - layer.after) / span;

          const target = Math.round(layer.amount * Math.min(1, restored) * 100) / 100;

          const already = refundedByRow[layer.rowNumber] || 0;

          const refund = Math.round((target - already) * 100) / 100;

          if (refund < 1) {
            return;
          }

          additions.push(base.concat([
            layer.after, current, '', refund,
            '払込再開・増額で年間拠出額が' + layer.after + '→' + current +
            'に戻ったため、' + layer.rowNumber + '行目の戻入のうち' + refund + 'を返金',
            '再開返金', layer.rowNumber
          ]));

          refundedByRow[layer.rowNumber] = already + refund;
        });
    }
  });

  if (additions.length > 0 && V19.WRITE_CLAWBACK && sheet) {
    sheet.getRange(lastRow + 1, 1, additions.length, header.length).setNumberFormat('@');
    sheet
      .getRange(lastRow + 1, 1, additions.length, header.length)
      .setValues(additions);
  }

  V19_STATE.newClawbacks = additions;

  /* お客様名（説明）：プラン番号 → 名前 */
  const customerByPlan = {};

  rowsInfo.forEach(info => {
    const plan = String(info.row[0] || '').trim();
    if (plan && info.row[1] && !customerByPlan[plan]) {
      customerByPlan[plan] = String(info.row[1]).trim();
    }
  });

  /* 記録をすべて計上（検出月に入る） */
  records.concat(additions.map(row => row.map(String))).forEach(record => {

    const month = v19_month_(record[0]);

    const id = v19_id_(record[1]);

    const amount = money(record[11]);

    if (!month || !id || !amount) {
      return;
    }

    const isRefund = record[13] === '再開返金';

    const isTransfer = record[13] === '担当者変更調整';

    const isStop = String(record[12]).indexOf('ため（年間拠出0）') >= 0;

    const row = Array(20).fill('');

    row[0] = record[2];                 // A プラン番号
    row[1] = isRefund ? '再開返金' : (isTransfer ? '担当者変更調整' : (isStop ? '解約・停止戻入' : '減額戻入'));   // B 説明
    row[2] = record[4];                 // C 商品コード
    row[5] = id;                        // F 支払対象者ID
    row[9] = record[7];                 // J 実質紹介料率
    row[11] = isRefund ? '返金' : '戻入'; // L 支払区分
    row[13] = amount;                   // N 今回支払額（戻入はマイナス・返金はプラス）
    row[14] = month;                    // O 支払月
    row[15] = v19_adjustExplain_(record, customerByPlan[String(record[2]).trim()] || '');   // P 備考①（推薦者にもそのまま見せる説明）

    rowsInfo.push({ row: row, id: id, month: month, sequence: record[3] });
  });
}



function v19_adjustExplain_(record, customer) {

  const num = value => v19_num_(String(value).replace(/[^0-9.\-]/g, ''));

  const usd = value => '$' + (Math.round(Math.abs(value) * 100) / 100)
    .toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const plan = String(record[2] || '').trim();

  const sequence = String(record[3] || '').trim();

  const who = plan + (sequence ? '（' + sequence + '）' : '') + (customer ? '・' + customer + '様' : '');

  const payMonth = v19_monthLabel_(v19_month_(record[5]));

  const paid = num(record[6]);

  const ratePercent = String(record[7] || '');

  const before = num(record[8]);

  const after = num(record[9]);

  const months = num(record[10]);

  const amount = num(record[11]);

  const reason = String(record[12] || '');

  const kind = String(record[13] || '');

  if (kind === '担当者変更調整') {

    const perMonth = paid / 12;

    const correct = perMonth * months;

    return '【戻入】' + who + '：' +
      'このご契約は担当者変更で弊社の担当になったもので、1年目12か月のうち' + (12 - months) +
      'か月分は前の担当で支払済みのため、弊社からお支払いできるのは残り' + months + 'か月分です。' +
      payMonth + 'に12か月分（' + usd(perMonth) + '×12＝' + usd(paid) + '）をお支払いしましたが、' +
      '正しくは' + months + 'か月分（' + usd(perMonth) + '×' + months + '＝' + usd(correct) + '）でしたので、' +
      '差額' + usd(amount) + 'を今回差し引きます。';
  }

  if (kind === '再開返金') {

    return '【返金】' + who + '：' +
      'お客様のお支払いが再開された（または積立額が戻った）ため、以前「戻入」として差し引いた分のうち' +
      usd(amount) + 'をお返しします（年間拠出額 ' + usd(before) + '→' + usd(after) + '）。';
  }

  const stopped = reason.indexOf('ため（年間拠出0）') >= 0;

  const overdue = reason.indexOf('90日') >= 0;

  const head = '【戻入】' + who + '：';

  const prepaid =
    'みなし年払いとして、' + payMonth + 'に1年分の紹介料（年間拠出額' + usd(before) +
    '×紹介料率' + ratePercent + '）を先にお支払いしていました。';

  if (stopped) {

    const cause = overdue
      ? 'お客様のお支払いが最終支払日から90日以上止まっているため、'
      : 'お客様のご契約が' + (reason.match(/「(.+?)」/) ? '「' + reason.match(/「(.+?)」/)[1] + '」' : '解約・失効') + 'となったため、';

    return head + prepaid + cause +
      'まだ積立が行われていない残り' + months + 'か月分（' + usd(before) + '×' + ratePercent +
      '×' + months + '/12＝' + usd(amount) + '）を今回差し引きます。' +
      (overdue ? 'お支払いが再開された場合は、差し引いた分をお返しします。' : '');
  }

  return head + prepaid +
    'お客様が積立額を減額されたため（年間' + usd(before) + '→' + usd(after) + '）、' +
    '残り' + months + 'か月分の差額（(' + usd(before) + '−' + usd(after) + ')×' + ratePercent +
    '×' + months + '/12＝' + usd(amount) + '）を今回差し引きます。';
}


/*************************************************
 * ★V18.9：戻入・返金の理由を台帳の備考に入れる
 *************************************************/

function v19_rate_(value) {

  if (typeof value === 'number') {
    return value > 1 ? value / 100 : value;
  }

  const text = String(value || '').trim();

  const num = v19_num_(text.replace(/[^0-9.\-]/g, ''));

  if (text.indexOf('%') >= 0) {
    return num / 100;
  }

  return num > 1 ? num / 100 : num;
}



function v19_collectAdjustNotes_(rowsInfo) {

  const notes = {};

  rowsInfo.forEach(info => {

    const kind = String(info.row[11] || '');

    if (!info.month || (kind !== '戻入' && kind !== '返金')) {
      return;
    }

    const key = info.month + '||' + info.id;

    const text = String(info.row[15] || '').replace(/ \/ /g, '／');

    (notes[key] || (notes[key] = [])).push(text);
  });

  return notes;
}



function v19_stripAdjustNote_(note) {

  return String(note || '')
    .split(' / ')
    .filter(part => !/^【(戻入|返金)】/.test(part.trim()))
    .join(' / ')
    .trim();
}



function v19_mergeAdjustNote_(note, adjust) {

  let result = String(note || '').trim();

  (adjust || []).forEach(text => {

    if (result.indexOf(text) < 0) {
      result = result ? result + ' / ' + text : text;
    }
  });

  return result;
}



function v19_applyAnnualCap_(rowsInfo, policyMap, transferMap) {

  const AMOUNT = V19.SOURCE_AMOUNT_COL - 1;   // N
  const RATE = AMOUNT - 1;                            // M
  const fromIndex = v19_monthIndex_(V19.ANNUAL_CAP_FROM);

  const money = value => '$' + (Math.round(value * 100) / 100).toLocaleString('en-US');

  rowsInfo.forEach(info => {

    const row = info.row;

    if (!info.month || info.hold) {
      return;
    }

    if (String(row[11] || '').trim() !== 'みなし' || v19_num_(row[RATE]) !== 12) {
      return;
    }

    const transferInfo =
      transferMap[String(row[0] || '').trim() + '||' + v19_sequenceKey_(info.sequence)] ||
      transferMap[String(row[0] || '').trim() + '||'];

    if (v19_monthIndex_(info.month) < fromIndex) {

      /* 支払済の過去月は金額を変えず、担当者変更の過払いは戻入で調整する */
      if (transferInfo && v19_num_(row[3]) < 2) {
        info.pastTransferCover = transferInfo.cover;
      }

      return;
    }

    const contribution = v19_num_(row[4]);   // E 拠出金額

    const commission = v19_num_(row[10]);    // K 支払額（1回分の紹介料）

    if (contribution <= 0 || commission <= 0) {
      return;
    }

    const policy = policyMap[String(row[0] || '').trim() + '||' + v19_sequenceKey_(info.sequence)];

    /*
     * 一括商品（確定利回り FIFR・プラチナ PLAT・ACS）は1回きりの紹介料。
     * ×12にせず×1。プランポリシーで年間拠出金0・一括払いありの契約も同じ。
     */
    const product = String(row[2] || '').trim();

    const isLumpProduct =
      /^(FIFR|PLAT|ACS)/i.test(product) ||
      (policy && policy.annual <= 0 && policy.lump > 0);

    if (isLumpProduct) {

      row[RATE] = 1;

      row[AMOUNT] = commission;

      info.capNote =
        '今回支払い対象（一括商品）：' + product +
        (policy && policy.group ? '（' + policy.group + '）' : '') +
        'は一括払いの商品のため、×12ではなく×1で1回のみ（' + money(commission) + '）を支払';

      return;
    }

    /*
     * ★V18.9：2年目以降（D列「期間」が2以上）はみなしではなく平準（毎月×1）。
     */
    const policyYear = v19_num_(row[3]);

    if (policyYear >= 2) {

      row[RATE] = 1;

      row[AMOUNT] = commission;

      row[11] = '平準（2年目〜）';   // 支払区分：みなし→平準に切り替わった印

      info.levelPay = true;

      info.capNote =
        '今回支払い対象（平準）：契約' + policyYear + '年目のため、' +
        'みなし年払い（1年目のみ）ではなく平準（毎月×1：' + money(commission) + '）で支払';

      row[15] = info.capNote;   // 平準はみなしの判定を通らないのでここで備考を書く

      info.noteChanged = true;

      return;
    }

    /*
     * ★V18.9：担当者変更で移ってきた契約。
     * 他社で支払済の月数（1年目のうち）を除いた残りの月数だけ支払う。
     * 12か月以上なら1年目は終わっているので平準。
     */
    const plan = String(row[0] || '').trim();

    const transfer = transferInfo;

    let coverMonths = 12;

    if (transfer) {

      if (transfer.cover <= 0) {

        row[RATE] = 1;

        row[AMOUNT] = commission;

        row[11] = '平準（担当者変更）';

        info.levelPay = true;

        info.capNote =
          '今回支払い対象（平準）：担当者変更の契約で、1年目の12か月分は他社で支払済のため、' +
          '平準（毎月×1：' + money(commission) + '）で支払';

        row[15] = info.capNote;

        info.noteChanged = true;

        return;
      }

      coverMonths = transfer.cover;

      info.coverMonths = coverMonths;
    }

    /* 年払い・前払い：今回の拠出金額が何か月分か（最大12） */
    const yearMonths = policy && policy.annual > 0
      ? Math.min(12, policy.annual / contribution)
      : 12;

    const multiplier = Math.round(yearMonths * coverMonths / 12 * 10000) / 10000;

    if (multiplier >= 12 - 0.0001) {
      return;   // 毎月払い・通常の契約：今までどおり×12
    }

    const capped = Math.round(commission * multiplier * 100) / 100;

    row[RATE] = multiplier;

    row[AMOUNT] = capped;

    const notes = [];

    if (transfer) {
      notes.push(
        '担当者変更の契約（1年目のうち' + (12 - coverMonths) +
        'か月分は他社で支払済・' + transfer.source + '）で、弊社分は残り' + coverMonths + 'か月分'
      );
    }

    if (yearMonths < 12 - 0.0001) {
      notes.push(
        '拠出金額' + money(contribution) + 'がすでに年間拠出金' + money(policy.annual) +
        (policy.frequency ? '（' + policy.frequency + '払い）' : '') +
        'の' + (Math.round(contribution / policy.annual * 100) / 100) + '年分'
      );
    }

    info.capNote =
      '今回支払い対象（みなし年払い）：' + notes.join('、') +
      'のため、×12ではなく×' + multiplier + '（' + money(capped) + '）を支払';
  });
}



function v19_loadTransferMap_(ss) {

  const map = {};

  /* ① 担当者変更一覧（別ファイル）：B プラン番号・C シーケンス・O みなし残数月 */
  try {

    const book = SpreadsheetApp.openById(V19.TRANSFER_SOURCE_ID);

    const list = book.getSheetByName(V19.TRANSFER_SOURCE_SHEET);

    if (list && list.getLastRow() >= 3) {

      list
        .getRange(3, 1, list.getLastRow() - 2, 16)
        .getDisplayValues()
        .forEach(row => {

          const plan = String(row[1] || '').trim();

          const remain = String(row[14] || '').trim();

          if (!plan || remain === '' || isNaN(Number(remain))) {
            return;
          }

          map[plan + '||' + v19_sequenceKey_(row[2])] = {
            cover: Math.max(0, Math.min(12, Math.floor(Number(remain)))),
            source: '担当者変更一覧'
          };
        });
    }

  } catch (error) {
    console.error('担当者変更一覧を読めません: ' + error.message);
  }

  /* ② 【手入力】担当者変更（手で入れたものを優先） */
  const header = ['プラン番号', 'シーケンス（空欄＝全部）', '他社で支払済の月数（1年目のうち）', 'メモ'];

  const sheet = ss.getSheetByName(V19.TRANSFER_SHEET);

  if (sheet && sheet.getLastRow() >= 2) {

    sheet
      .getRange(2, 1, sheet.getLastRow() - 1, 3)
      .getDisplayValues()
      .forEach(row => {

        const plan = String(row[0] || '').trim();

        const months = v19_num_(row[2]);

        if (!plan || !(months > 0)) {
          return;
        }

        map[plan + '||' + v19_sequenceKey_(row[1])] = {
          cover: Math.max(0, 12 - Math.floor(months)),
          source: '手入力'
        };
      });
  }

  return map;
}


/*************************************************
 * ★V18.9：最新月の M列（支払倍率）にシステムの判定結果を書く
 *
 * N列（今回支払額＝K×M の式）がシステムの支払額と一致するようにする。
 *   年払いの重複 → 0、2年目以降・一括・年払い契約 → 1、担当者変更 → 残り月数 など
 * 書き換える前の値は AB列に残し、次回からは AB列の値で計算し直す（何度動かしても同じ結果）。
 * 過去の月は触らない。
 *************************************************/

function v19_holdBrokenRows_(rowsInfo) {

  const from = v19_monthIndex_(V19.ANNUAL_CAP_FROM);

  let blankKubun = 0;

  rowsInfo.forEach(info => {

    if (!info.rowNumber || v19_monthIndex_(info.month) < from) {
      return;
    }

    const row = info.row;

    const kubun = String(row[11] || '').trim();

    const rate = row[12];

    const amount = row[13];

    const base = v19_num_(row[10]);

    const blank = value => value === '' || value === null || value === undefined;

    let reason = '';

    if (blank(amount) || v19_num_(amount) === 0) {
      return;
    }

    if (!kubun) {
      blankKubun++;
    }

    if (kubun === '平準' && v19_num_(rate) > 1) {
      reason = '支払保留：平準なのにM列（支払倍率）が' + rate + 'になっています（平準は×1）。' +
        '貼り付けずれの可能性があるので、M列を確認して①を押し直してください';
    } else if (!kubun || blank(rate)) {
      reason = '支払保留：' + (!kubun ? 'L列（支払区分）' : '') + (!kubun && blank(rate) ? '・' : '') +
        (blank(rate) ? 'M列（支払倍率）' : '') + 'が空欄のため、N列の' + amount +
        'は支払額として使えません。推薦者コード管理の「1年みなし2年目平準」を確認し、L列・M列を入れて①を押し直してください';
    } else if (Math.abs(v19_num_(amount) - base * v19_num_(rate)) >= 1) {
      reason = '支払保留：N列（今回支払額）' + amount + 'が K列（支払額）' + base + '×M列（支払倍率）' + rate +
        '＝' + (Math.round(base * v19_num_(rate) * 100) / 100) + 'と合わないため、貼り付けずれの可能性。行を確認して①を押し直してください';
    }

    if (!reason) {
      return;
    }

    row[13] = 0;

    row[15] = reason;

    info.hold = true;

    info.noteChanged = true;
  });

  /* L列がまとめて空欄＝L2の数式が壊れている（L列に手で値を入れると #REF! になる）可能性が高い */
  if (blankKubun >= 10) {
    v19_alert_(
      '⚠ L列（支払区分）が空欄の行が' + blankKubun + '件あり、その行は支払保留にしました。\n\n' +
      'L2の数式が #REF! になっていないか確認してください（L列の途中に手で値を入れると数式が止まります）。' +
      '直したら①を押し直してください。'
    );
  }
}



function v19_notePrepaidLevel_(rowsInfo, policyMap) {

  const latest = rowsInfo.reduce((value, info) =>
    v19_monthIndex_(info.month) > v19_monthIndex_(value) ? info.month : value, '');

  rowsInfo.forEach(info => {

    const row = info.row;

    if (info.month !== latest || info.hold || String(row[11] || '').trim() !== '平準' || String(row[15] || '').trim()) {
      return;
    }

    const policy = policyMap[String(row[0] || '').trim() + '||' + v19_sequenceKey_(info.sequence)];

    if (!policy || policy.lump > 0 || !(policy.annual > 0)) {
      return;
    }

    const monthly = policy.annual / 12;

    const months = Math.round(v19_num_(row[4]) / monthly);

    if (months < 2 || v19_num_(row[13]) <= 0) {
      return;
    }

    const start = v19_monthIndex_(info.month);

    const label = index => Math.floor((index - 1) / 12) + '.' + ((index - 1) % 12 + 1);

    row[15] = '先払い：お客様が' + months + 'か月分をまとめて拠出（$' + v19_num_(row[4]) +
      '＝月額$' + (Math.round(monthly * 100) / 100) + '×' + months + '）。コミッションも' + months +
      'か月分（' + label(start) + '〜' + label(start + months - 1) + '分）を今回まとめてお支払い。' +
      'この期間の翌月以降は明細に載りません。解約時は未経過分を戻入';

    info.noteChanged = true;
  });
}



function v19_monthIndex_(value) {

  const key = v19_monthKey_(value);

  if (!key) {
    return 0;
  }

  return Math.floor(key / 100) * 12 + (key % 100);
}



function v19_cents_(value) {

  return Math.round(v19_num_(value) * 100) / 100;
}



function v19_isPaid_(value) {

  const text = String(value || '').trim();

  return (
    text === '済' ||
    text === '支払済' ||
    text === '支払済み'
  );
}



function v19_isNoPayment_(value) {

  const text = String(value || '').trim();

  return (
    text === '不要' ||
    text === '支払不要' ||
    text === '支払い不要'
  );
}



function v19_isSettled_(value) {

  return v19_isPaid_(value) || v19_isNoPayment_(value);
}



function v19_monthLabel_(value) {

  const month = v19_month_(value);

  const match = String(month).match(/^(\d{4})\.(\d{1,2})$/);

  if (!match) {
    return String(month || '');
  }

  return match[1] + '年' + Number(match[2]) + '月';
}



function v19_month_(value) {

  if (value === '' || value === null || value === undefined) {
    return '';
  }

  if (value instanceof Date) {
    return value.getFullYear() + '.' + (value.getMonth() + 1);
  }

  const text = String(value).trim();

  const match = text.match(/^(\d{4})[.\/-](\d{1,2})$/);

  if (!match) {
    return '';
  }

  const year = Number(match[1]);

  const month = Number(match[2]);

  /* 1〜12以外は不正月として扱う（例：2026.89） */
  if (month < 1 || month > 12) {
    return '';
  }

  return year + '.' + month;
}



function v19_monthKey_(value) {

  const month = v19_month_(value);

  const match = String(month).match(/^(\d{4})\.(\d{1,2})$/);

  if (!match) {
    return 0;
  }

  return Number(match[1]) * 100 + Number(match[2]);
}



function v19_id_(value) {

  if (value === '' || value === null || value === undefined) {
    return '';
  }

  let text = String(value).trim();

  if (/^\d+\.0+$/.test(text)) {
    text = text.split('.')[0];
  }

  return text;
}



function v19_num_(value) {

  if (typeof value === 'number') {
    return value;
  }

  if (value === '' || value === null || value === undefined) {
    return 0;
  }

  const num = Number(
    String(value)
      .replace(/,/g, '')
      .replace(/\$/g, '')
      .replace(/¥/g, '')
      .trim()
  );

  return isNaN(num) ? 0 : num;
}


