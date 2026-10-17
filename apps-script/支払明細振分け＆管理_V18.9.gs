/*************************************************
 * 支払管理システム V18.9（V18.8修正版）
 *
 * ★V18.9の修正点
 * ・AUTO行の支払月が読めないときは台帳を書き換えずに止める
 *   （支払月が消えて旧行がMANUALとして残り、重複する事故の防止）。
 * ・repairLedgerDuplicatesV189：今回重複した台帳を元に戻す修復用（1回だけ実行）。
 *
 * ★V18.8の修正点
 * ・支払月を「表示されている文字」で読む（2026.10 が 2026.1＝1月に化けない）。
 *   台帳の支払月列・支払いまとめの月見出しも文字として書き込む。
 * ・みなし二重計上ガード：同じプラン番号＋商品コード＋支払対象者で
 *   12か月以内に既にみなし年払いした場合、後の月は0（支払対象外）。
 * ・元データから消えた未精算のAUTO行（誤読の残骸）は台帳に戻さない。
 *
 * ★V18.7の修正点（今回払出額の計算のみ・他はV18.6と同一）
 * ・W社／B社／繰越を「別々に」切り捨ててから合計していたため
 *   1ドルずれる不具合を修正。
 *   → 合計してから1回だけ小数点以下切り捨て。
 * ・計算誤差（1944 → 1943.9999…）で1ドル減る不具合を修正。
 * ・マイナスは従来どおりマイナスのまま表示・繰越（手数料なし）。
 * ・支払総額が手数料$5以下の少額は、手数料を引かず払出0、
 *   台帳の対応を「次回繰越」にして翌月へ繰越。
 * ・個別明細の W社／B社／繰越 はセント単位で表示
 *   （足し算が支払総額と一致するように）。
 *
 * ★V18.6の修正点
 * ① 台帳編集時のロック待ちを0.3秒→10秒に延長。
 *    それでも取れない場合はDIRTYを立てて
 *    次回の5分同期に必ず処理を引き継ぐ
 *    （編集イベントを捨てない）
 * ② 5分同期のたびに台帳のH/I/J
 *    （前月未払い繰越・総支払額・対応）を再計算。
 *    手動追記行が最悪でも5分以内に必ず反映される
 * ③ 再計算結果が変わらない場合は書き込みスキップ
 *    （無駄な更新・重い再描画の防止）
 *
 * ・高速差分更新
 * ・W社支払額
 * ・B社支払額
 * ・前月未払い繰越
 * ・総支払額
 * ・事務手数料 $5
 * ・小数点以下切り捨て
 * ・手書き追記保持（今後の手動追記はKEEP保護）
 * ・個別ファイル自動共有ON/OFF
 * ・1239 パクさんチーム管理
 *
 * ★外部共有明細
 * A:Rのみ
 * S＝最終更新
 *
 * 小グループ・大グループは
 * 外部共有ファイルには絶対に出さない
 *************************************************/


const PAYMENT_V18 = {

  SOURCE_SHEET: '【手入力固定】計算用まとめ（永久保存版）',
  MASTER_SHEET: '【自動】推薦者コード管理_取込',
  LEDGER_SHEET: '支払管理台帳',
  MAIN_SUMMARY_SHEET: '支払いまとめ',
  DETAIL_SHEET: '支払明細',
  NOTICE_SHEET: '支払集計',
  FILE_PREFIX: '【自動更新】支払明細_',

  /*************************************************
   * パクさんチーム
   *************************************************/
  TEAM_OWNER_ID: '1239',
  TEAM_SMALL_GROUP: 'パクさん',
  TEAM_INDEX_SHEET: 'パクさんチーム一覧',
  TEAM_TAB_PREFIX: 'パク_',

  /*************************************************
   * 元データ
   *************************************************/
  SOURCE_COLS: 20,
  SOURCE_ID_COL: 6,       // F
  SOURCE_AMOUNT_COL: 14,  // N
  SOURCE_MONTH_COL: 15,   // O
  SOURCE_SEQUENCE_COL: 21, // U シーケンス
  SOURCE_JUDGE_COL: 27,    // AA 支払判定（自動）
  SOURCE_ORIGINAL_RATE_COL: 28, // AB 元の支払倍率（自動・M列を書き換える前の値）

  /* ★V18.9：途中減額の戻入の記録 */
  CLAWBACK_SHEET: '【自動】減額戻入',
  TRANSFER_SHEET: '【手入力】担当者変更',

  /* 担当者変更一覧（管理シート（マスター）※コミッション含 の「担当者変更後」） */
  TRANSFER_SOURCE_ID: '1-Z8RxBMwXVVvOKcJ6C9UrLdeSmNxwRDZw466SAfxlRE',
  TRANSFER_SOURCE_SHEET: '担当者変更後',
  PASTE_SHEET: '貼付用(支払詳細）',
  CONTRACT_SHEET: '【自動固定】契約時データ（永久保存版）',
  CUSTOMER_SHEET: '【手入力】顧客マスタ',
  APPLY_SOURCE_ID: '1ophzS1nD2KE8WanjAySl3Lj5RDHioDxegTjKw5mRd1A',
  APPLY_SOURCE_SHEET: '★',
  LOST_SHEET: '【確認】迷子契約',
  OWN_INTRO_CODES: ['583102', '582755'],

  /* ★V18.9：年間拠出金による上限をかける最初の支払月（これより前の月は支払済のため触らない） */
  POLICY_SHEET: 'プランポリシー',
  ANNUAL_CAP_FROM: '2026.10',

  /*************************************************
   * 推薦者マスタ
   *************************************************/
  MASTER_HEADER_ROW: 4,
  MASTER_START_ROW: 5,
  MASTER_NAME_COL: 2,     // B
  MASTER_CODE_COL: 3,     // C
  MASTER_LARGE_COL: 11,   // K
  MASTER_SMALL_COL: 12,   // L
  MASTER_FOLDER_COL: 23,  // W

  /*************************************************
   * 自動共有
   *************************************************/
  SHARE_HEADER: '支払明細自動共有',
  SHARE_ON: 'する',
  SHARE_OFF: 'しない',

  /*************************************************
   * 手数料
   *************************************************/
  ADMIN_FEE: 5,

  /*************************************************
   * 内部管理
   *************************************************/
  AUTO: 'AUTO',
  MANUAL: 'MANUAL',
  CARRY: 'CARRY',

  /* ★V18.9：false＝推薦者ファイルはボタンを押したときだけ更新 */
  AUTO_PUBLISH: false,

  /* 外部用明細の書き方を変えたら上げる（全員のファイルが次の反映で書き直される） */
  PUBLIC_DETAIL_VERSION: 'V18.9-PUBLIC-5',

  /* 旧版の保護値。V18.5では移行対象として扱う */
  LEGACY_KEEP: 'KEEP',

  /* V18.5以降にユーザーが手動追記した行だけに付ける永久保護値 */
  USER_KEEP: 'USER_KEEP',

  /*
   * ★既存の個別ファイルHASHはなるべく活かして
   * 全31ファイルを毎回開かないよう
   * VERSION文字列はV18.5のまま変更しない。
   */
  VERSION: '20260919-V18.5-FINAL-MERGE',
  LEDGER_FORMAT_VERSION: '20260919-V18.5-LEDGER-FINAL',
  DETAIL_FORMAT_VERSION: '20260824-V18.1-DETAIL',

  /* ★V18.7：明細の金額表示（セント単位）を反映させるため更新 */
  NOTICE_FORMAT_VERSION: '20261013-V18.7-NOTICE',

  TEAM_FORMAT_VERSION: '20260824-V18.2-TEAM-FIX'

};


/*************************************************
 * ★最初に実行
 *************************************************/
function setupPaymentSystemV18() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!ss) {
    throw new Error('元スプレッドシートを取得できません。');
  }

  const props = PropertiesService.getScriptProperties();

  props.setProperty('PAY18_SOURCE_SSID', ss.getId());

  const master = ss.getSheetByName(PAYMENT_V18.MASTER_SHEET);

  if (!master) {
    throw new Error('【自動】推薦者コード管理_取込 がありません。');
  }

  pay18_ensureShareColumn_(master);

  pay18_migrateOldTargetCache_();

  setupPaymentV18Triggers();

  /*
   * V18.5導入時は必ず全体再構築。
   */
  forceSyncPaymentSheetsV18();
}


/*************************************************
 * 通常同期
 *************************************************/
function syncPaymentSheetsV18() {
  pay18_fullSync_(false);
}


/*************************************************
 * 全員強制更新
 *************************************************/
function forceSyncPaymentSheetsV18() {
  pay18_fullSync_(true);
}


/*************************************************
 * ★V18.9：推薦者ファイルに反映（共有）ボタン
 *
 * 台帳・支払いまとめを最新にしてから、
 * 各推薦者の【自動更新】支払明細と朴さんチームのファイルを更新する。
 * 前回の反映から変わった人のファイルだけ開く。
 *************************************************/
function publishPaymentFilesV18() {

  const result = pay18_fullSync_(false, true);

  pay18_alert_('推薦者ファイルへの反映が終わりました。\n' + pay18_publishSummary_(result));
}


/* 全員のファイルを作り直す（表示が崩れたときなど） */
function publishAllPaymentFilesV18() {

  const result = pay18_fullSync_(true, true);

  pay18_alert_('全員の推薦者ファイルを作り直しました。\n' + pay18_publishSummary_(result));
}


function pay18_publishSummary_(result) {

  if (!result) {
    return '（結果を取得できませんでした）';
  }

  return [
    '更新したファイル：' + result.opened + '件',
    '変更なし：' + result.skipped + '件',
    '共有しない設定：' + result.disabled + '件',
    'フォルダなし：' + result.noFolder + '件',
    'エラー：' + result.errors + '件'
  ].concat(result.messages.slice(0, 5)).join('\n');
}


/*
 * スプレッドシートを開くとメニュー「支払管理」が出る。
 * 「契約時保存」メニューの onOpen とぶつからないよう、
 * 名前を変えて「開いたとき」トリガーで呼ぶ（installPaymentMenuV18 で登録）。
 */
function installPaymentMenuV18() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'showPaymentMenuV18')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('showPaymentMenuV18')
    .forSpreadsheet(ss)
    .onOpen()
    .create();

  showPaymentMenuV18();
}


function showPaymentMenuV18() {

  SpreadsheetApp.getUi()
    .createMenu('支払管理')
    .addItem('① 計算を更新（社内のみ）', 'forceSyncPaymentSheetsV18')
    .addItem('② 推薦者ファイルに反映（共有）', 'publishPaymentFilesV18')
    .addSeparator()
    .addItem('全員のファイルを作り直す', 'publishAllPaymentFilesV18')
    .addSeparator()
    .addItem('迷子契約の推薦者を顧客マスタへ追加', 'fillLostContractsV18')
    .addToUi();
}


/*************************************************
 * ★迷子契約 → 【手入力】顧客マスタ
 *
 * 貼付用(支払詳細）にあって契約時データにない契約（＝迷子契約）の推薦者を
 * プラン番号＋シーケンス で探し、顧客マスタの空き行に追加する。
 *   探す順：① 担当者変更一覧「担当者変更後」（変更後の担当を優先）
 *           ② 申込フォーム「★」（BK プラン番号・BL シーケンス・BM 推薦者コード）
 *   書く列：A プラン番号 / B 氏名 / C 商品コード / D シーケンス / E L1_ID
 * 貼付用のシーケンスがプランポリシーと違うものは入れずに「直す場所」を表示する。
 * イントロデューサー（プランポリシー A・B列）が Wawasan・Izaaz 以外で推薦者が見つからないものは
 * マネージャーフィー（誰にも払わない）として顧客マスタには入れない。
 * 結果は【確認】迷子契約の G列「備考」にも書く。
 * すでに顧客マスタにあるもの・見つからないものは入れない。
 * 追加後はいつもどおり「契約時保存」で契約時データへ保存してください。
 *************************************************/
function fillLostContractsV18() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const clean = value => String(value || '').replace(/[\s　]/g, '');

  /* 契約時データのキー（プラン|商品|シーケンス）。迷子契約シートと同じ判定 */
  const contract = ss.getSheetByName(PAYMENT_V18.CONTRACT_SHEET);

  const known = {};

  const knownPlan = {};

  if (contract && contract.getLastRow() >= 3) {
    contract
      .getRange(3, 1, contract.getLastRow() - 2, 5)
      .getDisplayValues()
      .forEach(row => {

        const plan = clean(row[0]);

        known[plan + '|' + clean(row[2]) + '|' + pay18_sequenceKey_(row[3])] = true;

        if (clean(row[4])) {
          knownPlan[plan] = knownPlan[plan] || {};
          knownPlan[plan][clean(row[4])] = true;
        }
      });
  }

  /* 迷子契約（貼付用 D プラン・E 氏名・F 商品・P 最終シーケンス） */
  const paste = ss.getSheetByName(PAYMENT_V18.PASTE_SHEET);

  if (!paste || paste.getLastRow() < 3) {
    pay18_alert_('「' + PAYMENT_V18.PASTE_SHEET + '」にデータがありません。');
    return;
  }

  const lost = [];

  const seen = {};


  paste
    .getRange(3, 1, paste.getLastRow() - 2, 16)
    .getDisplayValues()
    .forEach((row, index) => {

      const plan = clean(row[3]);

      if (!plan) {
        return;
      }

      const product = clean(row[5]);

      const sequence = pay18_sequenceKey_(row[15]);

      const key = plan + '|' + product + '|' + sequence;

      if (known[key] || seen[key]) {
        return;
      }

      seen[key] = true;

      lost.push({
        key: key,
        plan: plan,
        product: product,
        sequence: sequence,
        name: String(row[4] || '').trim(),
        row: index + 3,
        manual: String(row[14] || '').trim(),
        rate: String(row[9] || '').trim(),
        period: pay18_num_(row[6])
      });
    });

  if (!lost.length) {
    pay18_alert_('迷子契約はありません。');
    return;
  }

  /* プランポリシー：プラン＋商品 → 正しいシーケンス */
  const policySeq = {};

  const policyIntro = {};

  const policyMap = pay18_loadPolicyMap_(ss);

  Object.keys(policyMap).forEach(key => {

    const parts = key.split('||');

    const id = parts[0] + '|' + clean(policyMap[key].product);

    (policySeq[id] = policySeq[id] || []).push(parts[1]);

    if (policyMap[key].introCode) {
      policyIntro[key] = policyMap[key];
      policyIntro[parts[0]] = policyIntro[parts[0]] || policyMap[key];
    }
  });

  /* 推薦者の照合元（プラン||シーケンス → {code, payee, name, source}） */
  const finder = {};

  const errors = [];

  const readBook = (label, id, sheetName, startRow, read) => {

    try {

      const sheet = SpreadsheetApp.openById(id).getSheetByName(sheetName);

      if (!sheet || sheet.getLastRow() < startRow) {
        errors.push(label + '：シート「' + sheetName + '」が空か見つかりません');
        return;
      }

      sheet
        .getRange(startRow, 1, sheet.getLastRow() - startRow + 1, sheet.getLastColumn())
        .getDisplayValues()
        .forEach(row => {

          const hit = read(row);

          if (!hit || !hit.plan || !hit.code || /#N\/A/.test(hit.code)) {
            return;
          }

          const key = hit.plan + '||' + pay18_sequenceKey_(hit.sequence);

          if (!finder[key]) {
            finder[key] = { code: hit.code, payee: hit.payee, name: hit.name, source: label };
          }
        });

    } catch (error) {
      errors.push(label + 'を開けません：' + error.message);
    }
  };

  /* ① 担当者変更後（B プラン・C シーケンス・E 氏名・F 推薦者コード・G 推薦者名） */
  readBook('担当者変更後', PAYMENT_V18.TRANSFER_SOURCE_ID, PAYMENT_V18.TRANSFER_SOURCE_SHEET, 3, row => ({
    plan: clean(row[1]),
    sequence: row[2],
    name: String(row[4] || '').trim(),
    code: String(row[5] || '').trim(),
    payee: String(row[6] || '').trim()
  }));

  /* ② 申込フォーム（B 姓・C 名・BK プラン・BL シーケンス・BM 推薦者コード・BN 推薦者名） */
  readBook('申込フォーム', PAYMENT_V18.APPLY_SOURCE_ID, PAYMENT_V18.APPLY_SOURCE_SHEET, 2, row => ({
    plan: clean(row[62]),
    sequence: row[63],
    name: [String(row[1] || '').trim(), String(row[2] || '').trim()].filter(String).join(', '),
    code: String(row[64] || '').trim(),
    payee: String(row[65] || '').trim()
  }));

  /* 顧客マスタ：既存キーと空き行 */
  const master = ss.getSheetByName(PAYMENT_V18.CUSTOMER_SHEET);

  if (!master) {
    pay18_alert_('「' + PAYMENT_V18.CUSTOMER_SHEET + '」がありません。');
    return;
  }

  const lastRow = Math.max(master.getLastRow(), 3);

  const current = master.getRange(3, 1, lastRow - 2, 4).getDisplayValues();

  const inMaster = {};

  let nextRow = 3;

  current.forEach((row, index) => {

    if (clean(row[0])) {
      inMaster[clean(row[0]) + '||' + pay18_sequenceKey_(row[3])] = true;
      nextRow = index + 4;
    }
  });

  const added = [];

  const wrongSeq = [];

  const already = [];

  const notFound = [];

  const managerFee = [];

  const notes = {};

  lost.forEach(item => {

    const label = item.plan + '（' + item.product + '・' + (item.sequence || 'シーケンス空欄') + '）' + item.name;

    const right = policySeq[item.plan + '|' + item.product] || [];

    if (right.length && right.indexOf(item.sequence) < 0) {
      wrongSeq.push(
        label + ' → 貼付用' + item.row + '行目：プランポリシーでは「' + right.join('・') + '」' +
        (item.manual ? '（O列の手動シーケンス「' + item.manual + '」を直すか消してください）' : '')
      );
      notes[item.key] = 'シーケンス違い：プランポリシーでは「' + right.join('・') + '」。貼付用' + item.row +
        '行目' + (item.manual ? 'のO列（手動シーケンス）' : '') + 'を直してください';
      return;
    }

    const key = item.plan + '||' + item.sequence;

    const hit = item.sequence ? finder[key] : null;

    if (!hit) {

      const others = Object.keys(knownPlan[item.plan] || {});

      const text = label + '（紹介料率' + (item.rate || '空欄') + '・' + (item.period || '?') + '年目）' +
        (others.length ? '（同じプラン番号の別契約は推薦者 ' + others.join('・') + '）' : '');

      /* プランポリシーのイントロデューサーが Wawasan・Izaaz 以外 ＝ マネージャーフィー（誰にも払わない） */
      const intro = policyIntro[item.plan + '||' + item.sequence] || policyIntro[item.plan];

      if (intro && PAYMENT_V18.OWN_INTRO_CODES.indexOf(clean(intro.introCode)) < 0) {
        managerFee.push(text + ' イントロ：' + intro.introCode + ' ' + intro.introName);
        notes[item.key] = 'マネージャーフィーの可能性あり（誰にも払わない）／イントロ：' +
          intro.introCode + ' ' + intro.introName +
          (others.length ? '／※同じプラン番号の別契約は推薦者 ' + others.join('・') + ' に支払中' : '');
      } else {
        notFound.push(text);
        notes[item.key] = '推薦者が見つかりません（担当者変更後・申込フォームにない）。手で確認してください';
      }
      return;
    }

    if (inMaster[key]) {
      already.push(label);
      notes[item.key] = '顧客マスタに入力済み：推薦者 ' + hit.code + '（契約時保存をすると消えます）';
      return;
    }

    inMaster[key] = true;

    notes[item.key] = '顧客マスタに追加：推薦者 ' + hit.code + ' ' + hit.payee + '（' + hit.source + '）。契約時保存をすると消えます';

    added.push({
      row: [item.plan, hit.name || item.name, item.product, item.sequence, hit.code],
      label: label + ' → ' + hit.code + ' ' + hit.payee + '（' + hit.source + '）'
    });
  });

  if (added.length) {

    const range = master.getRange(nextRow, 1, added.length, 5);

    range.offset(0, 4, added.length, 1).setNumberFormat('@');

    range.setValues(added.map(item => item.row));
  }

  const noteResult = pay18_writeLostNotes_(ss, lost, notes);

  const section = (title, items) =>
    items.length ? '\n\n■ ' + title + '（' + items.length + '件）\n' + items.join('\n') : '';

  pay18_alert_(
    '迷子契約 ' + lost.length + '件を照合しました。' +
    section('顧客マスタに追加', added.map(item => item.label)) +
    section('シーケンス違い（貼付用を直せば迷子ではなくなります）', wrongSeq) +
    section('すでに顧客マスタにある', already) +
    section('推薦者が見つからない（手で確認してください）', notFound) +
    section('マネージャーフィーの可能性あり（誰にも払わない・顧客マスタに入れない）', managerFee) +
    section('読めなかった照合元', errors) +
    '\n\n' + noteResult +
    (added.length ? '\n\n追加した行を確認して、いつもどおり「契約時保存」をしてください。' : '')
  );
}


/* 【確認】迷子契約 G列「備考」
 * 結果は隠し列 Y（プラン番号|商品コード）・Z（備考）に置き、G3 の数式で引く。
 * A3 の FILTER の行が増減しても備考がずれない。 */
function pay18_writeLostNotes_(ss, lost, notes) {

  const sheet = ss.getSheetByName(PAYMENT_V18.LOST_SHEET);

  if (!sheet) {
    return '「' + PAYMENT_V18.LOST_SHEET + '」が見つからないため、備考は書いていません。';
  }

  const merged = {};

  const order = [];

  lost.forEach(item => {

    const key = item.plan + '|' + item.product;

    const note = notes[item.key] || '';

    if (!(key in merged)) {
      merged[key] = [];
      order.push(key);
    }

    if (note) {
      merged[key].push({ sequence: item.sequence, note: note });
    }
  });

  /* 同じプラン番号＋商品でシーケンス違いが複数あるときだけ、シーケンス名を付けて並べる */
  const text = key => merged[key].length > 1
    ? merged[key].map(entry => (entry.sequence || 'シーケンス空欄') + '：' + entry.note).join(' ／ ')
    : (merged[key][0] ? merged[key][0].note : '');

  if (sheet.getMaxColumns() < 26) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), 26 - sheet.getMaxColumns());
  }

  sheet.getRange(1, 25, sheet.getMaxRows(), 2).clearContent();

  sheet.getRange(2, 25, 1, 2).setValues([['照合キー（自動）', '備考（自動）']]);

  if (order.length) {
    sheet
      .getRange(3, 25, order.length, 2)
      .setNumberFormat('@')
      .setValues(order.map(key => [key, text(key)]));
  }

  sheet.hideColumns(25, 2);

  if (sheet.getMaxRows() > 2) {
    sheet.getRange(3, 7, sheet.getMaxRows() - 2, 1).clearContent();
  }

  sheet.getRange(2, 7).setValue('備考（ボタンで自動）').setFontWeight('bold');

  sheet.getRange(3, 7).setFormula(
    '=MAP(A3:A,C3:C,LAMBDA(p,c,IF(OR(p="",p="該当なし"),"",' +
    'IFERROR(VLOOKUP(SUBSTITUTE(TRIM(p)," ","")&"|"&SUBSTITUTE(TRIM(c)," ",""),$Y$3:$Z,2,FALSE),""))))'
  );

  return '【確認】迷子契約のG列「備考」に結果を表示しました。';
}


function pay18_alert_(message) {

  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (error) {
    console.log(message);
  }
}


/*************************************************
 * ★V18.9：支払管理台帳の重複修復（1回だけ手動実行）
 *
 * 支払月が空欄になってMANUALとして残った旧7〜9月の行（108行）に
 * 支払月を書き戻し、管理情報の入っていない重複AUTO行を消してから
 * 全員強制更新する。10月分の行は強制更新で作り直される。
 * 空欄行の推薦者コードの並びが想定と1つでも違えば、何も変更せずに止まる。
 *************************************************/
const PAY18_REPAIR_PLAN_V189 =
  '2026.7:195 2026.7:1109 2026.7:1379 2026.7:1666 2026.7:1239 2026.7:1596 2026.7:1706 2026.7:1799 2026.7:1801 2026.7:1803 ' +
  '2026.7:1233 2026.7:1316 2026.7:1714 2026.7:1715 2026.7:1728 2026.7:1291 2026.7:12 2026.7:13 2026.7:1474 2026.7:1551 ' +
  '2026.8:195 2026.8:1109 2026.8:1379 2026.8:1239 2026.8:1289 2026.8:1596 2026.8:1706 2026.8:1769 2026.8:1799 2026.8:1801 ' +
  '2026.8:1803 2026.8:1822 2026.8:1233 2026.8:1316 2026.8:1714 2026.8:1715 2026.8:1720 2026.8:1726 2026.8:1728 2026.8:1687 ' +
  '2026.8:1291 2026.8:12 2026.8:13 2026.8:1205 2026.8:1373 2026.8:1474 2026.8:1547 2026.8:1551 2026.8:1655 ' +
  '2026.9:195 2026.9:1109 2026.9:1379 2026.9:1239 2026.9:1289 2026.9:1355 2026.9:1460 2026.9:1596 2026.9:1705 2026.9:1706 ' +
  '2026.9:1769 2026.9:1799 2026.9:1801 2026.9:1803 2026.9:1822 2026.9:1823 2026.9:1233 2026.9:1316 2026.9:1714 2026.9:1715 ' +
  '2026.9:1717 2026.9:1720 2026.9:1728 2026.9:1687 2026.9:1824 2026.9:1829 2026.9:1830 2026.9:1831 2026.9:1833 2026.9:1834 ' +
  '2026.9:1835 2026.9:1838 2026.9:122 2026.9:160 2026.9:1291 2026.9:1681 2026.9:1168 2026.9:12 2026.9:13 2026.9:1205 ' +
  '2026.9:1373 2026.9:1474 2026.9:1547 2026.9:1551 2026.9:1655 2026.9:1790 2026.9:1825 ' +
  '2026.9:1726:M 2026.9:1713:M 2026.9:1815:M 2026.7:1625:M 2026.8:1713:M 2026.8:1625:M 2026.8:1806:M 2026.8:1815:M ' +
  '2026.9:1493:M 2026.9:1666:M 2026.9:1806:M 2026.9:1625:M';

function repairLedgerDuplicatesV189() {

  const plan = PAY18_REPAIR_PLAN_V189.split(' ').map(token => {
    const parts = token.split(':');
    return { month: parts[0], id: parts[1], manual: parts[2] === 'M' };
  });

  const lock = LockService.getScriptLock();

  if (!lock.tryLock(60000)) {
    throw new Error('同期が実行中です。1〜2分待ってからもう一度実行してください。');
  }

  try {

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const sheet = ss.getSheetByName(PAYMENT_V18.LEDGER_SHEET);

    const lastRow = sheet.getLastRow();

    const values = sheet.getRange(1, 1, lastRow, 20).getValues();

    const monthDisplay = sheet.getRange(1, 1, lastRow, 1).getDisplayValues();

    const orphans = [];

    for (let i = 1; i < values.length; i++) {

      if (!pay18_id_(values[i][1])) {
        continue;
      }

      if (String(monthDisplay[i][0] || '').trim() === '') {
        orphans.push(values[i]);
      }
    }

    if (orphans.length !== plan.length) {
      throw new Error(
        '支払月が空欄の行が' + orphans.length + '行あります（想定' + plan.length +
        '行）。台帳が想定と違うため何も変更していません。'
      );
    }

    orphans.forEach((row, index) => {

      if (pay18_id_(row[1]) !== plan[index].id) {
        throw new Error(
          '空欄行' + (index + 1) + '番目の推薦者コードが' + pay18_id_(row[1]) +
          '（想定' + plan[index].id + '）。何も変更していません。'
        );
      }
    });

    const output = [values[0].slice(0, 20)];

    orphans.forEach((row, index) => {

      const next = row.slice(0, 20);

      next[0] = plan[index].month;
      next[18] = plan[index].manual ? PAYMENT_V18.MANUAL : PAYMENT_V18.AUTO;
      next[19] = plan[index].manual ? PAYMENT_V18.USER_KEEP : '';

      output.push(next);
    });

    sheet.getRange(1, 1, lastRow, 20).clearContent();

    sheet.getRange(1, 1, sheet.getMaxRows(), 1).setNumberFormat('@');

    sheet.getRange(1, 1, output.length, 20).setValues(output);

    SpreadsheetApp.flush();

  } finally {

    lock.releaseLock();
  }

  forceSyncPaymentSheetsV18();

  console.log('V18.9 台帳修復完了');
}


/*************************************************
 * 5分バックアップ
 *************************************************/
function backupPaymentV18Sync() {
  pay18_fullSync_(false);
}


/*************************************************
 * 編集時
 *************************************************/
function autoSyncPaymentV18OnEdit(e) {

  if (!e || !e.range) {
    return;
  }

  const sheet = e.range.getSheet();
  const name = sheet.getName();

  /* 支払管理台帳 */
  if (name === PAYMENT_V18.LEDGER_SHEET) {
    pay18_fastLedgerEdit_(e);
    return;
  }

  /* 推薦者マスタ */
  if (name === PAYMENT_V18.MASTER_SHEET) {
    if (pay18_handleShareSettingEdit_(e)) {
      return;
    }
  }

  PropertiesService.getScriptProperties().setProperty('PAY18_DIRTY', '1');
}


/*************************************************
 * 自動共有列
 *************************************************/
function pay18_ensureShareColumn_(sheet) {

  const headerRow = PAYMENT_V18.MASTER_HEADER_ROW;

  const lastCol = Math.max(1, sheet.getLastColumn());

  const headers = sheet
    .getRange(headerRow, 1, 1, lastCol)
    .getDisplayValues()[0]
    .map(v => String(v || '').trim());

  let shareCol = headers.indexOf(PAYMENT_V18.SHARE_HEADER) + 1;

  if (!shareCol) {

    shareCol = lastCol + 1;

    if (sheet.getMaxColumns() < shareCol) {
      sheet.insertColumnAfter(lastCol);
    }

    sheet
      .getRange(headerRow, shareCol)
      .setValue(PAYMENT_V18.SHARE_HEADER)
      .setNote('空欄または「する」＝個別明細を自動更新\n「しない」＝個別明細の自動更新を停止');

    sheet.setColumnWidth(shareCol, 150);
  }

  const rule = SpreadsheetApp
    .newDataValidation()
    .requireValueInList([PAYMENT_V18.SHARE_ON, PAYMENT_V18.SHARE_OFF], true)
    .setAllowInvalid(true)
    .build();

  const rows = Math.max(1, sheet.getMaxRows() - PAYMENT_V18.MASTER_START_ROW + 1);

  sheet
    .getRange(PAYMENT_V18.MASTER_START_ROW, shareCol, rows, 1)
    .setDataValidation(rule);

  return shareCol;
}


/*************************************************
 * 自動共有設定変更
 *************************************************/
function pay18_handleShareSettingEdit_(e) {

  const sheet = e.range.getSheet();

  const lastCol = sheet.getLastColumn();

  const headers = sheet
    .getRange(PAYMENT_V18.MASTER_HEADER_ROW, 1, 1, lastCol)
    .getDisplayValues()[0];

  const shareCol = headers.findIndex(
    v => String(v || '').trim() === PAYMENT_V18.SHARE_HEADER
  ) + 1;

  if (!shareCol) {
    return false;
  }

  if (shareCol < e.range.getColumn() || shareCol > e.range.getLastColumn()) {
    return false;
  }

  const startRow = Math.max(PAYMENT_V18.MASTER_START_ROW, e.range.getRow());

  const endRow = e.range.getLastRow();

  if (endRow < PAYMENT_V18.MASTER_START_ROW) {
    return true;
  }

  const count = endRow - startRow + 1;

  const ids = sheet
    .getRange(startRow, PAYMENT_V18.MASTER_CODE_COL, count, 1)
    .getDisplayValues()
    .flat();

  const settings = sheet
    .getRange(startRow, shareCol, count, 1)
    .getDisplayValues()
    .flat();

  const disabled = pay18_getDisabledIds_();

  const props = PropertiesService.getScriptProperties();

  ids.forEach((rawId, index) => {

    const id = pay18_id_(rawId);

    if (!id) {
      return;
    }

    if (pay18_isShareEnabled_(settings[index])) {
      disabled.delete(id);
    } else {
      disabled.add(id);
    }

    props.deleteProperty('PAY18_DETAIL_HASH_' + id);
    props.deleteProperty('PAY18_NOTICE_HASH_' + id);
  });

  pay18_saveDisabledIds_(disabled);

  props.deleteProperty('PAY18_PAK_TEAM_HASH');

  props.setProperty('PAY18_DIRTY', '1');

  return true;
}


/*************************************************
 * 台帳編集高速処理
 *
 * ★V18.6修正①
 * ロック待ちを10秒へ延長。
 * それでも取れない場合はDIRTYを立てて
 * 次回の全体同期に処理を任せる（編集を捨てない）。
 *************************************************/
function pay18_fastLedgerEdit_(e) {

  const lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {

    /*
     * 5分同期の実行中はロックが取れないことがある。
     * 次回の全体同期（最大5分後）で必ず反映させる。
     */
    PropertiesService.getScriptProperties().setProperty('PAY18_DIRTY', '1');

    return;
  }

  try {

    const sheet = e.range.getSheet();

    const startRow = Math.max(2, e.range.getRow());

    const endRow = e.range.getLastRow();

    if (endRow < 2) {
      return;
    }

    /*
     * S = 管理種別
     * T = 手動保護
     *
     * ★今後、下へ手動追記した行は
     * MANUAL + USER_KEEP にして永久保護する。
     */
    pay18_ensureSheetSize_(sheet, endRow, 20);

    const rowCount = endRow - startRow + 1;

    const range = sheet.getRange(startRow, 1, rowCount, 20);

    const rows = range.getValues();

    const affectedIds = new Set();

    const now = new Date();

    let masterMap = null;

    const needMaster =
      e.range.getColumn() <= 5 &&
      e.range.getLastColumn() >= 2;

    if (needMaster) {

      const ss = pay18_getSourceSS_();

      masterMap = pay18_loadMaster_(
        ss.getSheetByName(PAYMENT_V18.MASTER_SHEET)
      );
    }

    rows.forEach(row => {

      const hasData = row
        .slice(0, 18)
        .some(value => value !== '' && value !== null);

      if (!hasData) {
        return;
      }

      const id = pay18_id_(row[1]);

      if (id) {

        affectedIds.add(id);

        if (masterMap && masterMap[id]) {

          if (!row[2]) {
            row[2] = masterMap[id].name;
          }

          if (!row[3]) {
            row[3] = masterMap[id].largeGroup;
          }

          if (!row[4]) {
            row[4] = masterMap[id].smallGroup;
          }
        }
      }

      row[17] = now;

      /*
       * AUTO行を編集した場合はAUTOのまま。
       * 空欄行・既存MANUAL行を触った場合は
       * MANUAL + USER_KEEP にする。
       */
      const marker = String(row[18] || '').trim();

      if (marker !== PAYMENT_V18.AUTO && marker !== PAYMENT_V18.CARRY) {

        row[18] = PAYMENT_V18.MANUAL;

        row[19] = PAYMENT_V18.USER_KEEP;
      }
    });

    range.setValues(rows);

    try {
      sheet.hideColumns(19, 2);
    } catch (error) {}

    if (affectedIds.size === 0) {
      return;
    }

    pay18_recalculateLedger_(sheet, affectedIds);

    const ledgerState = pay18_buildLedgerState_(sheet);

    pay18_updateMainSummary_(sheet.getParent(), ledgerState, false);

    const props = PropertiesService.getScriptProperties();

    const disabled = pay18_getDisabledIds_();

    affectedIds.forEach(id => {

      /* ★V18.9：推薦者ファイルはボタンを押したときだけ更新 */
      if (!PAYMENT_V18.AUTO_PUBLISH) {
        return;
      }

      if (disabled.has(id)) {
        return;
      }

      const targetId = props.getProperty('PAY18_TARGET_' + id);

      if (!targetId) {

        props.setProperty('PAY18_DIRTY', '1');

        return;
      }

      try {

        const target = SpreadsheetApp.openById(targetId);

        const ledgerRows = ledgerState.byCode[id] || [];

        pay18_writeNotice_(target, id, ledgerRows, props);

        props.setProperty(
          'PAY18_NOTICE_HASH_' + id,
          pay18_noticeHash_(id, ledgerRows)
        );

      } catch (error) {

        props.deleteProperty('PAY18_TARGET_' + id);

        props.setProperty('PAY18_DIRTY', '1');
      }
    });

    pay18_fastUpdatePakTeamIndex_(ledgerState, affectedIds, props);

  } finally {

    lock.releaseLock();
  }
}


/*************************************************
 * 全体同期
 *************************************************/
function pay18_fullSync_(forceAll, publish) {

  const lock = LockService.getScriptLock();

  /* ★V18.9：共有ボタンのときは他の同期が終わるまで最大60秒待つ */
  if (!lock.tryLock(publish ? 60000 : 1000)) {

    if (publish) {
      throw new Error('別の同期が実行中です。1〜2分待ってからもう一度押してください。');
    }

    return;
  }

  const startTime = Date.now();

  try {

    const context = pay18_loadContext_();

    if (!context) {
      return;
    }

    const props = PropertiesService.getScriptProperties();

    pay18_cacheDisabledIds_(context.masterMap);

    pay18_cachePakIds_(context.masterMap);

    /*************************************************
     * 台帳
     *************************************************/
    const ledgerSheet = context.ss.getSheetByName(PAYMENT_V18.LEDGER_SHEET);

    const newLedgerHash = pay18_ledgerSourceHash_(context);

    const oldLedgerHash = props.getProperty('PAY18_LEDGER_SOURCE_HASH');

    const oldLedgerCodeVersion = props.getProperty('PAY18_LEDGER_CODE_VERSION');

    let ledgerState;

    if (
      forceAll ||
      !ledgerSheet ||
      ledgerSheet.getLastRow() < 2 ||
      newLedgerHash !== oldLedgerHash ||
      oldLedgerCodeVersion !== PAYMENT_V18.LEDGER_FORMAT_VERSION
    ) {

      ledgerState = pay18_rebuildLedger_(context);

      props.setProperty('PAY18_LEDGER_SOURCE_HASH', newLedgerHash);

      props.setProperty('PAY18_LEDGER_CODE_VERSION', PAYMENT_V18.LEDGER_FORMAT_VERSION);

    } else {

      /*
       * ★V18.6修正②
       * 元データに変更がなくても、台帳の
       * H/I/J（前月未払い繰越・総支払額・対応）を
       * 毎回の同期で必ず計算し直す。
       */
      pay18_recalculateLedger_(ledgerSheet, null);

      ledgerState = pay18_buildLedgerState_(ledgerSheet);
    }

    pay18_updateMainSummary_(context.ss, ledgerState, forceAll);

    /*
     * ★V18.9：推薦者ごとのファイル（外部共有）は
     * 「推薦者ファイルに反映」ボタンを押したときだけ更新する。
     * 5分ごとの同期では社内のシート（台帳・支払いまとめ）だけ更新。
     */
    if (!publish && !PAYMENT_V18.AUTO_PUBLISH) {

      console.log(
        'V18.9 社内のみ更新完了（推薦者ファイルは未反映） / ' +
        ((Date.now() - startTime) / 1000).toFixed(1) + '秒'
      );

      return;
    }

    const ids = [
      ...new Set([
        ...Object.keys(context.groups),
        ...Object.keys(ledgerState.byCode)
      ])
    ];

    let opened = 0;
    let skipped = 0;
    let disabled = 0;
    let noFolder = 0;
    let errors = 0;
    const messages = [];

    /*************************************************
     * 各推薦者
     *************************************************/
    ids.forEach(id => {

      try {

        const master = context.masterMap[id];

        if (!master) {
          noFolder++;
          return;
        }

        if (!master.autoShare) {
          disabled++;
          return;
        }

        if (!master.folderId) {
          noFolder++;
          return;
        }

        const detailRows = context.groups[id] || [];

        const ledgerRows = ledgerState.byCode[id] || [];

        const detailHash = pay18_detailHash_(
          id,
          master,
          context.publicHeader,
          detailRows,
          context.hiddenColumns
        );

        const noticeHash = pay18_noticeHash_(id, ledgerRows);

        const oldDetailHash = props.getProperty('PAY18_DETAIL_HASH_' + id);

        const oldNoticeHash = props.getProperty('PAY18_NOTICE_HASH_' + id);

        const cached = props.getProperty('PAY18_TARGET_' + id);

        const detailChanged = forceAll || detailHash !== oldDetailHash;

        const noticeChanged = forceAll || noticeHash !== oldNoticeHash;

        /*
         * ★変更なしならファイル自体を開かない
         */
        if (!detailChanged && !noticeChanged && cached) {
          skipped++;
          return;
        }

        const target = pay18_getTargetSS_(id, master, props);

        opened++;

        if (detailChanged) {

          pay18_writeDetail_(
            target,
            context.publicHeader,
            detailRows,
            context.hiddenColumns,
            props
          );

          props.setProperty('PAY18_DETAIL_HASH_' + id, detailHash);
        }

        if (noticeChanged) {

          pay18_writeNotice_(target, id, ledgerRows, props);

          props.setProperty('PAY18_NOTICE_HASH_' + id, noticeHash);
        }

      } catch (error) {

        errors++;

        messages.push(id + '：' + error.message);

        console.error(id + ' : ' + error.message);
      }
    });

    /*************************************************
     * パクさんチーム
     *************************************************/
    try {

      pay18_updatePakTeamWorkbook_(context, ledgerState, props, forceAll);

    } catch (error) {

      errors++;

      messages.push('パクさんチーム：' + error.message);

      console.error('パクさんチーム : ' + error.message);
    }

    props.deleteProperty('PAY18_DIRTY');

    console.log(
      'V18.9完了 | OPEN=' + opened +
      ' / SKIP=' + skipped +
      ' / 共有停止=' + disabled +
      ' / フォルダなし=' + noFolder +
      ' / ERR=' + errors +
      ' / ' + ((Date.now() - startTime) / 1000).toFixed(1) + '秒'
    );

    return { opened, skipped, disabled, noFolder, errors, messages };

  } finally {

    lock.releaseLock();
  }
}


/*************************************************
 * 元データ
 *************************************************/
function pay18_loadContext_() {

  const ss = pay18_getSourceSS_();

  const source = ss.getSheetByName(PAYMENT_V18.SOURCE_SHEET);

  const masterSheet = ss.getSheetByName(PAYMENT_V18.MASTER_SHEET);

  if (!source) {
    throw new Error(PAYMENT_V18.SOURCE_SHEET + ' がありません。');
  }

  if (!masterSheet) {
    throw new Error(PAYMENT_V18.MASTER_SHEET + ' がありません。');
  }

  const masterMap = pay18_loadMaster_(masterSheet);

  const lastRow = source.getLastRow();

  if (lastRow < 2) {
    return null;
  }

  const all = source
    .getRange(1, 1, lastRow, PAYMENT_V18.SOURCE_COLS)
    .getValues();

  const internalHeader = all[0].slice(0, 20);

  /* 内部のみ */
  internalHeader[18] = '小グループ';

  internalHeader[19] = '大グループ';

  /* ★外部共有はA:R */
  const publicHeader = internalHeader.slice(0, 18);

  /*
   * ★V18.8：支払月は「表示されている文字」で読む
   * （2026.10 が数値 2026.1 として保存されていても 10月と判定する）
   */
  const monthDisplay = source
    .getRange(1, PAYMENT_V18.SOURCE_MONTH_COL, lastRow, 1)
    .getDisplayValues();

  /* ★V18.9：U列「シーケンス」（みなし二重計上の判定に使う） */
  const sequenceValues = source
    .getRange(1, PAYMENT_V18.SOURCE_SEQUENCE_COL, lastRow, 1)
    .getDisplayValues();

  /* ★V18.9：AB列＝システムがM列を書き換える前の元の支払倍率 */
  const originalRates = source.getMaxColumns() >= PAYMENT_V18.SOURCE_ORIGINAL_RATE_COL
    ? source.getRange(1, PAYMENT_V18.SOURCE_ORIGINAL_RATE_COL, lastRow, 1).getValues()
    : [];

  const groups = {};
  const aggregate = {};

  const rowsInfo = [];

  all.slice(1).forEach((original, index) => {

    const row = original.slice(0, 20);

    /* 元の支払倍率（M列を書き換え済みなら AB列）から計算し直す */
    const sheetRate = row[12];

    const savedRate = originalRates.length ? originalRates[index + 1][0] : '';

    if (savedRate !== '' && savedRate !== null && !isNaN(Number(savedRate))) {
      row[12] = Number(savedRate);
      row[13] = Math.round(pay18_num_(row[10]) * Number(savedRate) * 100) / 100;
    }

    const id = pay18_id_(row[PAYMENT_V18.SOURCE_ID_COL - 1]);

    if (!id) {
      return;
    }

    const month = pay18_month_(monthDisplay[index + 1][0]);

    row[PAYMENT_V18.SOURCE_MONTH_COL - 1] = month;

    rowsInfo.push({
      row: row,
      id: id,
      month: month,
      sequence: String(sequenceValues[index + 1][0] || '').trim(),
      sheetRate: sheetRate,
      savedRate: savedRate,
      rowNumber: index + 2,
      originalNote: String(original[15] || '')
    });
  });

  const policyMap = pay18_loadPolicyMap_(ss);

  /* ★V18.9：年払い・前払いのみなし過払い防止（プランポリシーの年間拠出金で上限） */
  pay18_applyAnnualCap_(rowsInfo, policyMap, pay18_loadTransferMap_(ss));

  pay18_applyMinashiGuard_(rowsInfo);

  pay18_writeJudgeColumn_(source, all, rowsInfo, lastRow);

  pay18_writeFinalRates_(source, rowsInfo);

  /* ★V18.9：途中減額の戻入（記録シートに残し、検出した月にマイナス行として計上） */
  pay18_applyReductionClawback_(ss, rowsInfo, policyMap);

  rowsInfo.forEach(info => {

    const row = info.row;

    const id = info.id;

    const month = info.month;

    const master = masterMap[id];

    /* 内部用 */
    row[18] = master ? master.smallGroup : '';

    row[19] = master ? master.largeGroup : '';

    if (!groups[id]) {
      groups[id] = [];
    }

    groups[id].push(row);

    if (!month) {
      return;
    }

    const key = month + '||' + id;

    if (!aggregate[key]) {

      aggregate[key] = {
        key: key,
        month: month,
        id: id,
        name: master ? master.name : String(row[6] || ''),
        largeGroup: master ? master.largeGroup : '',
        smallGroup: master ? master.smallGroup : '',
        wAmount: 0
      };
    }

    aggregate[key].wAmount += pay18_num_(row[PAYMENT_V18.SOURCE_AMOUNT_COL - 1]);
  });

  /* N:Rのみ非表示設定同期 */
  const hiddenColumns = {};

  for (let col = 14; col <= 18; col++) {
    hiddenColumns[col] = source.isColumnHiddenByUser(col);
  }

  return {
    ss: ss,
    source: source,
    masterMap: masterMap,
    internalHeader: internalHeader,
    publicHeader: publicHeader,
    adjustNotes: pay18_collectAdjustNotes_(rowsInfo),
    groups: groups,
    aggregate: aggregate,
    hiddenColumns: hiddenColumns
  };
}


/*************************************************
 * ★V18.8：みなし二重計上ガード
 *
 * 同じ「プラン番号＋シーケンス（空欄なら商品コード）＋支払対象者」で、
 * すでに過去の月（12か月以内）にみなし年払い（今回支払額>0）が
 * 計上されている場合、後の月のみなし行は支払対象外（0）にする。
 * 備考①に「YYYY.Mに支払済（すでに12か月分支払済)」を表示。
 *************************************************/
function pay18_applyMinashiGuard_(rowsInfo) {

  const AMOUNT = PAYMENT_V18.SOURCE_AMOUNT_COL - 1;   // N
  const RATE = AMOUNT - 1;                            // M 支払倍率
  const KUBUN = 11;                                   // L 支払区分
  const NOTE = 15;                                    // P 備考①

  const targets = rowsInfo
    .filter(info =>
      info.month &&
      String(info.row[KUBUN] || '').trim() === 'みなし' &&
      !info.levelPay &&
      pay18_num_(info.row[3]) < 2 &&
      pay18_num_(info.row[AMOUNT]) > 0
    )
    .map((info, order) => ({ info: info, order: order }))
    .sort((a, b) => {
      const diff = pay18_monthIndex_(a.info.month) - pay18_monthIndex_(b.info.month);
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

    const key = pay18_monthIndex_(info.month) + '||' +
      String(info.row[0] || '').trim() + '||' + info.id;

    (sequencesByMonthPlan[key] || (sequencesByMonthPlan[key] = new Set()))
      .add(info.sequence || '');
  });

  const fmt = value => {
    const num = Math.round(pay18_num_(value) * 100) / 100;
    return String(num);
  };

  const paidByPlan = {};

  targets.forEach(item => {

    const info = item.info;

    const plan = String(info.row[0] || '').trim();

    const planKey = plan + '||' + info.id;

    const product = String(info.row[2] || '').trim();

    const sequence = info.sequence || '';

    const contribution = pay18_num_(info.row[4]);   // E 拠出金額

    const amount = pay18_num_(info.row[AMOUNT]);

    const index = pay18_monthIndex_(info.month);

    const history = paidByPlan[planKey] || (paidByPlan[planKey] = []);

    const recent = history.filter(record =>
      index > record.index && index - record.index < 12
    );

    const sameNumbers = record =>
      record.product === product &&
      Math.abs(record.contribution - contribution) < 0.005 &&
      Math.abs(record.amount - amount) < 0.005;

    let reason = '';

    /* ① プラン番号＋シーケンスが同じ（シーケンス空欄なら商品コード） */
    const bySequence = recent.find(record =>
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


/*************************************************
 * ★V18.9：みなしの支払判定の理由を AA列「支払判定（自動）」に書く
 *
 * P列（備考①）はP2のMAP式が自動で埋める列なので、スクリプトは書かない。
 * 以前のV18.9がP列に書いてしまった文字（式の展開を止めて #REF! になる）は
 * 見つけたら消して、式が元どおり展開されるようにする。
 * AA列は最新月の行だけ理由を書き、それ以外は空欄。
 *************************************************/
function pay18_writeJudgeColumn_(source, all, rowsInfo, lastRow) {

  /* ① 以前P列に書いた文字を消す（2行目のMAP式は残す） */
  const isOwnNote = text =>
    text.indexOf('今回支払い対象（みなし年払い）：') === 0 ||
    text.indexOf('みなし年払いは12か月に1回のため今回は支払対象外') >= 0 ||
    text.indexOf('2行目は支払対象外') >= 0 ||
    text.indexOf('シーケンス付け間違いと判断') >= 0;

  const blockers = [];

  for (let r = 2; r < all.length; r++) {   // 3行目以降

    const text = String(all[r][15] || '');

    if (text && isOwnNote(text)) {
      blockers.push('P' + (r + 1));
    }
  }

  if (blockers.length > 0) {
    source.getRangeList(blockers).clearContent();
  }

  /* ② AA列に最新月の判定理由 */
  const latestSourceMonth = rowsInfo.reduce((latest, info) =>
    pay18_monthIndex_(info.month) > pay18_monthIndex_(latest) ? info.month : latest, '');

  const column = PAYMENT_V18.SOURCE_JUDGE_COL;

  const output = [];

  for (let r = 2; r <= lastRow; r++) {
    output.push(['']);
  }

  rowsInfo.forEach(info => {

    if (info.noteChanged && info.month === latestSourceMonth) {
      output[info.rowNumber - 2][0] = String(info.row[15] || '');
    }
  });

  if (source.getMaxColumns() < column) {
    source.insertColumnsAfter(source.getMaxColumns(), column - source.getMaxColumns());
  }

  const header = source.getRange(1, column);

  if (header.getValue() !== '支払判定（自動）') {

    header.setValue('支払判定（自動）');

    /* P列に表示されるので、AA列は隠しておく */
    try {
      source.hideColumns(column);
    } catch (error) {}
  }

  if (output.length === 0) {
    return;
  }

  const range = source.getRange(2, column, output.length, 1);

  const current = range.getValues();

  const changed = current.some((row, index) =>
    String(row[0] || '') !== output[index][0]
  );

  if (changed) {
    range.setValues(output);
  }
}


/*************************************************
 * ★V18.9：外部共有ファイル用の短い備考
 *************************************************/
function pay18_publicNote_(value) {

  const text = String(value || '');

  if (text.indexOf('今回支払い対象（平準）') === 0) {
    return '今回支払い対象（平準・毎月）';
  }

  if (text.indexOf('担当者変更の契約') >= 0 && text.indexOf('×12ではなく') >= 0) {
    return '今回支払い対象（みなし年払い・担当者変更のため1年目の残り月数分）';
  }

  /* 戻入・返金は双方で齟齬がないよう、説明文をそのまま出す */
  if (/^【(戻入|返金)】/.test(text)) {
    return text;
  }

  if (text.indexOf('今回支払い対象（一括商品）') === 0) {
    return '今回支払い対象（一括商品・1回のみ）';
  }

  if (text.indexOf('×12ではなく') >= 0) {
    return '今回支払い対象（みなし年払い・拠出金額が1年分以上のため1年分）';
  }

  if (text.indexOf('今回支払い対象（みなし年払い）') === 0) {
    return '今回支払い対象（みなし年払い）';
  }

  if (text.indexOf('2行目は支払対象外') >= 0) {
    return '重複のため対象外';
  }

  const paid = text.match(/(\d{4}\.\d{1,2})に支払済/);

  if (paid && text.indexOf('支払対象外') >= 0) {
    return paid[1] + 'に支払済のため対象外';
  }

  if (text.indexOf('シーケンス付け間違いと判断') >= 0) {
    const month = text.match(/が(\d{4}\.\d{1,2})に支払済/);
    return (month ? month[1] + 'に' : '') + '支払済のため対象外';
  }

  return text;
}


/*************************************************
 * ★V18.9：プランポリシー（年間拠出金）
 *
 * 4行目が見出し。プラン番号＋シーケンス → 支払頻度・年間拠出金。
 *************************************************/
function pay18_loadPolicyMap_(ss) {

  const map = {};

  const sheet = ss.getSheetByName(PAYMENT_V18.POLICY_SHEET);

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

    map[plan + '||' + pay18_sequenceKey_(row[c.sequence])] = {
      frequency: c.frequency >= 0 ? String(row[c.frequency] || '').trim() : '',
      annual: pay18_num_(String(row[c.annual] || '').replace(/[^0-9.\-]/g, '')),
      lump: c.lump >= 0 ? pay18_num_(String(row[c.lump] || '').replace(/[^0-9.\-]/g, '')) : 0,
      product: c.productName >= 0 ? String(row[c.productName] || '').split(' - ')[0].trim() : '',
      status: c.status >= 0 ? String(row[c.status] || '').trim() : '',
      lastPaid: c.lastPaid >= 0 ? pay18_parseDate_(row[c.lastPaid]) : null,
      group: c.group >= 0 ? String(row[c.group] || '').trim() : '',
      introCode: c.introCode >= 0 ? String(row[c.introCode] || '').trim() : '',
      introName: c.introName >= 0 ? String(row[c.introName] || '').trim() : ''
    };
  });

  /* A1 の日付＝プランポリシーを貼り付けた日（無ければ今日） */
  const asOf = pay18_parseDate_(sheet.getRange(1, 1).getDisplayValue()) || new Date();

  Object.defineProperty(map, '__asOf', { value: asOf, enumerable: false });

  return map;
}


/* 2026/10/21・2026-10-21・21/10/2026 を日付に */
function pay18_parseDate_(value) {

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


function pay18_sequenceKey_(value) {
  return String(value || '')
    .replace(/[\s　]/g, '')
    .replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xFEE0))
    .replace(/ライダ[-ー－‐]?/g, 'ライダー');
}


/*************************************************
 * ★V18.9：途中減額・解約・払込停止の戻入／再開時の返金
 *
 * みなし年払いは「支払時の年間拠出額 × 実質紹介料率」を前払いしている。
 *   支払時の年間拠出額 ＝ 今回支払額 ÷ 実質紹介料率（担当者変更は×12÷残り月数）
 * 今の年間拠出額（プランポリシー）がそれより下がったら戻入：
 *   戻入額 ＝（下がる前 − 今）× 実質紹介料率 × 残り月数 ÷ 12
 *   残り月数 ＝ 対象月数（通常12）−（見つけた月 − みなし支払月）
 * 今の年間拠出額を0とみなすもの：
 *   状態が 解約済み・失効済み・払込済み
 *   状態が 有効（期間経過）で、最終の支払済日から90日を超えたもの
 * 戻入のあと年間拠出額が戻ったら（払込再開・増額）、戻した分の戻入を返金する。
 *
 * 1件ずつ【自動】減額戻入シートに残し、見つけた月にマイナス（返金はプラス）の行で計上。
 * 二重には引かない／二重には返さない。一括商品・プランポリシーに無い契約は対象外。
 *************************************************/
function pay18_applyReductionClawback_(ss, rowsInfo, policyMap) {

  const AMOUNT = PAYMENT_V18.SOURCE_AMOUNT_COL - 1;   // N

  const GRACE_DAYS = 90;

  const header = [
    '検出月', '推薦者コード', 'プラン番号', 'シーケンス', '商品コード',
    'みなし支払月', 'みなし支払額', '実質紹介料率', '変更前の年間拠出額',
    '変更後の年間拠出額', '残り月数', '金額', '理由', '区分', '対象行'
  ];

  let sheet = ss.getSheetByName(PAYMENT_V18.CLAWBACK_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(PAYMENT_V18.CLAWBACK_SHEET);
    sheet.setFrozenRows(1);
  }

  /*
   * ★V18.9修正：前の版は紹介料率を1/100で読み、検出月 2026.10 を 2026.1 と保存したため、
   * 誤った戻入が記録された。1回だけ記録を消して作り直す。
   */
  const props = PropertiesService.getScriptProperties();

  if (props.getProperty('PAY18_CLAWBACK_RESET_V2') !== '1') {

    if (sheet.getLastRow() >= 2) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(15, sheet.getLastColumn())).clearContent();
    }

    props.setProperty('PAY18_CLAWBACK_RESET_V2', '1');
  }

  /* 検出月・みなし支払月は文字で保存（2026.10 が 2026.1 にならないように） */
  sheet.getRange(1, 1, sheet.getMaxRows(), 1).setNumberFormat('@');
  sheet.getRange(1, 6, sheet.getMaxRows(), 1).setNumberFormat('@');
  sheet.getRange(1, 8, sheet.getMaxRows(), 1).setNumberFormat('@');

  if (String(sheet.getRange(1, 14).getValue() || '') !== '区分') {
    sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  }

  const lastRow = sheet.getLastRow();

  const records = lastRow >= 2
    ? sheet.getRange(2, 1, lastRow - 1, header.length).getDisplayValues()
    : [];

  const latestMonth = rowsInfo.reduce((latest, info) =>
    pay18_monthIndex_(info.month) > pay18_monthIndex_(latest) ? info.month : latest, '');

  if (!latestMonth) {
    return;
  }

  const latestIndex = pay18_monthIndex_(latestMonth);

  const asOf = policyMap.__asOf || new Date();

  const money = value => pay18_num_(String(value).replace(/[^0-9.\-]/g, ''));

  const recordKey = (id, plan, sequence, payMonth) =>
    [pay18_id_(id), String(plan || '').trim(), pay18_sequenceKey_(sequence), pay18_month_(payMonth)].join('||');

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

    if (info.levelPay || pay18_num_(row[3]) >= 2) {
      return;   // 平準（2年目以降）は前払いしていないので戻入なし
    }

    let paid = pay18_num_(row[AMOUNT]);

    const rate = pay18_rate_(row[9]);   // J 実質紹介料率（0.25 でも "25%" でも可）

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

      const commission = pay18_num_(row[10]);

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

    const elapsed = latestIndex - pay18_monthIndex_(info.month);

    const remaining = coverMonths - elapsed;

    if (elapsed < 0 || remaining <= 0) {
      return;   // 対象期間を過ぎたもの
    }

    let policy = policyMap[plan + '||' + pay18_sequenceKey_(info.sequence)];

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

  if (additions.length > 0) {
    sheet
      .getRange(lastRow + 1, 1, additions.length, header.length)
      .setValues(additions);
  }

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

    const month = pay18_month_(record[0]);

    const id = pay18_id_(record[1]);

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
    row[15] = pay18_adjustExplain_(record, customerByPlan[String(record[2]).trim()] || '');   // P 備考①（推薦者にもそのまま見せる説明）

    rowsInfo.push({ row: row, id: id, month: month, sequence: record[3] });
  });
}


/*************************************************
 * ★V18.9：戻入・返金の説明文（推薦者が読んで分かるように、計算式まで書く）
 *************************************************/
function pay18_adjustExplain_(record, customer) {

  const num = value => pay18_num_(String(value).replace(/[^0-9.\-]/g, ''));

  const usd = value => '$' + (Math.round(Math.abs(value) * 100) / 100)
    .toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const plan = String(record[2] || '').trim();

  const sequence = String(record[3] || '').trim();

  const who = plan + (sequence ? '（' + sequence + '）' : '') + (customer ? '・' + customer + '様' : '');

  const payMonth = pay18_monthLabel_(pay18_month_(record[5]));

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
/* 紹介料率：0.25（数値）・"25%"・"25.00%" → 0.25 */
function pay18_rate_(value) {

  if (typeof value === 'number') {
    return value > 1 ? value / 100 : value;
  }

  const text = String(value || '').trim();

  const num = pay18_num_(text.replace(/[^0-9.\-]/g, ''));

  if (text.indexOf('%') >= 0) {
    return num / 100;
  }

  return num > 1 ? num / 100 : num;
}


function pay18_collectAdjustNotes_(rowsInfo) {

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


/* 自動で入れた【戻入】【返金】の文を取り除く（毎回作り直すため） */
function pay18_stripAdjustNote_(note) {

  return String(note || '')
    .split(' / ')
    .filter(part => !/^【(戻入|返金)】/.test(part.trim()))
    .join(' / ')
    .trim();
}


function pay18_mergeAdjustNote_(note, adjust) {

  let result = String(note || '').trim();

  (adjust || []).forEach(text => {

    if (result.indexOf(text) < 0) {
      result = result ? result + ' / ' + text : text;
    }
  });

  return result;
}


/*************************************************
 * ★V18.9：みなし年払いの上限
 *
 * みなし（支払倍率12）は「月々の紹介料×12か月」の考え方。
 * 今回の拠出金額がすでに複数か月分（年払い・前払い）のときに×12すると過払いになる。
 * そこで「年間拠出金 ÷ 今回の拠出金額」を倍率の上限にする（最大12）。
 *   例）年払い：拠出1,800／年間1,800 → 倍率1
 *       12か月前払い：拠出1,200／年間1,200 → 倍率1
 *       毎月：拠出100／年間1,200 → 倍率12（今までどおり）
 *************************************************/
function pay18_applyAnnualCap_(rowsInfo, policyMap, transferMap) {

  const AMOUNT = PAYMENT_V18.SOURCE_AMOUNT_COL - 1;   // N
  const RATE = AMOUNT - 1;                            // M
  const fromIndex = pay18_monthIndex_(PAYMENT_V18.ANNUAL_CAP_FROM);

  const money = value => '$' + (Math.round(value * 100) / 100).toLocaleString('en-US');

  rowsInfo.forEach(info => {

    const row = info.row;

    if (!info.month) {
      return;
    }

    if (String(row[11] || '').trim() !== 'みなし' || pay18_num_(row[RATE]) !== 12) {
      return;
    }

    const transferInfo =
      transferMap[String(row[0] || '').trim() + '||' + pay18_sequenceKey_(info.sequence)] ||
      transferMap[String(row[0] || '').trim() + '||'];

    if (pay18_monthIndex_(info.month) < fromIndex) {

      /* 支払済の過去月は金額を変えず、担当者変更の過払いは戻入で調整する */
      if (transferInfo && pay18_num_(row[3]) < 2) {
        info.pastTransferCover = transferInfo.cover;
      }

      return;
    }

    const contribution = pay18_num_(row[4]);   // E 拠出金額

    const commission = pay18_num_(row[10]);    // K 支払額（1回分の紹介料）

    if (contribution <= 0 || commission <= 0) {
      return;
    }

    const policy = policyMap[String(row[0] || '').trim() + '||' + pay18_sequenceKey_(info.sequence)];

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
    const policyYear = pay18_num_(row[3]);

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


/*************************************************
 * ★V18.9：担当者変更（他社から移ってきた契約）
 *
 * 【手入力】担当者変更 シート
 *   A プラン番号
 *   B シーケンス（空欄＝そのプランの全シーケンス）
 *   C 他社で支払済の月数（1年目のうち。例：6）
 *   D メモ
 *************************************************/
function pay18_loadTransferMap_(ss) {

  const map = {};

  /* ① 担当者変更一覧（別ファイル）：B プラン番号・C シーケンス・O みなし残数月 */
  try {

    const book = SpreadsheetApp.openById(PAYMENT_V18.TRANSFER_SOURCE_ID);

    const list = book.getSheetByName(PAYMENT_V18.TRANSFER_SOURCE_SHEET);

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

          map[plan + '||' + pay18_sequenceKey_(row[2])] = {
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

  let sheet = ss.getSheetByName(PAYMENT_V18.TRANSFER_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(PAYMENT_V18.TRANSFER_SHEET);
    sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  if (sheet.getLastRow() >= 2) {

    sheet
      .getRange(2, 1, sheet.getLastRow() - 1, 3)
      .getDisplayValues()
      .forEach(row => {

        const plan = String(row[0] || '').trim();

        const months = pay18_num_(row[2]);

        if (!plan || !(months > 0)) {
          return;
        }

        map[plan + '||' + pay18_sequenceKey_(row[1])] = {
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
function pay18_writeFinalRates_(source, rowsInfo) {

  const latest = rowsInfo.reduce((value, info) =>
    pay18_monthIndex_(info.month) > pay18_monthIndex_(value) ? info.month : value, '');

  if (!latest) {
    return;
  }

  const column = PAYMENT_V18.SOURCE_ORIGINAL_RATE_COL;

  if (source.getMaxColumns() < column) {
    source.insertColumnsAfter(source.getMaxColumns(), column - source.getMaxColumns());
  }

  const header = source.getRange(1, column);

  if (header.getValue() !== '元の支払倍率（自動）') {

    header.setValue('元の支払倍率（自動）');

    try {
      source.hideColumns(column);
    } catch (error) {}
  }

  rowsInfo.forEach(info => {

    if (info.month !== latest || !info.rowNumber) {
      return;
    }

    const finalRate = info.row[12];

    const current = info.sheetRate;

    const same =
      String(finalRate) === String(current) ||
      (!isNaN(Number(finalRate)) && !isNaN(Number(current)) &&
        String(current) !== '' && Math.abs(Number(finalRate) - Number(current)) < 0.00001);

    if (same) {
      return;
    }

    const hasSaved = info.savedRate !== '' && info.savedRate !== null && info.savedRate !== undefined;

    if (!hasSaved) {
      source.getRange(info.rowNumber, column).setValue(current);
    }

    source.getRange(info.rowNumber, 13).setValue(finalRate);   // M 支払倍率
  });
}


function pay18_monthIndex_(value) {

  const key = pay18_monthKey_(value);

  if (!key) {
    return 0;
  }

  return Math.floor(key / 100) * 12 + (key % 100);
}


/*************************************************
 * 推薦者マスタ
 *************************************************/
function pay18_loadMaster_(sheet) {

  const lastRow = sheet.getLastRow();

  if (lastRow < PAYMENT_V18.MASTER_START_ROW) {
    return {};
  }

  const lastCol = sheet.getLastColumn();

  const headers = sheet
    .getRange(PAYMENT_V18.MASTER_HEADER_ROW, 1, 1, lastCol)
    .getDisplayValues()[0]
    .map(v => String(v || '').trim());

  const shareIndex = headers.indexOf(PAYMENT_V18.SHARE_HEADER);

  const rows = sheet
    .getRange(
      PAYMENT_V18.MASTER_START_ROW,
      1,
      lastRow - PAYMENT_V18.MASTER_START_ROW + 1,
      lastCol
    )
    .getDisplayValues();

  const map = {};

  rows.forEach(row => {

    const id = pay18_id_(row[PAYMENT_V18.MASTER_CODE_COL - 1]);

    if (!id) {
      return;
    }

    let folderId = String(row[PAYMENT_V18.MASTER_FOLDER_COL - 1] || '').trim();

    const match = folderId.match(/folders\/([A-Za-z0-9_-]+)/);

    if (match) {
      folderId = match[1];
    }

    map[id] = {
      id: id,
      name: String(row[PAYMENT_V18.MASTER_NAME_COL - 1] || '').trim(),
      largeGroup: pay18_cleanGroup_(row[PAYMENT_V18.MASTER_LARGE_COL - 1]),
      smallGroup: pay18_cleanGroup_(row[PAYMENT_V18.MASTER_SMALL_COL - 1]),
      folderId: folderId,
      autoShare: pay18_isShareEnabled_(shareIndex >= 0 ? row[shareIndex] : '')
    };
  });

  return map;
}


/*************************************************
 * 自動共有判定
 *************************************************/
function pay18_isShareEnabled_(value) {

  const text = String(value || '').trim().toLowerCase();

  return ![
    'しない',
    '共有しない',
    '停止',
    'off',
    'false',
    '×',
    '不要'
  ].includes(text);
}


/*************************************************
 * 共有停止
 *************************************************/
function pay18_cacheDisabledIds_(masterMap) {

  const ids = Object
    .keys(masterMap)
    .filter(id => !masterMap[id].autoShare);

  PropertiesService
    .getScriptProperties()
    .setProperty('PAY18_DISABLED_IDS', JSON.stringify(ids));
}


function pay18_getDisabledIds_() {

  const raw = PropertiesService
    .getScriptProperties()
    .getProperty('PAY18_DISABLED_IDS');

  if (!raw) {
    return new Set();
  }

  try {
    return new Set(JSON.parse(raw));
  } catch (error) {
    return new Set();
  }
}


function pay18_saveDisabledIds_(set) {

  PropertiesService
    .getScriptProperties()
    .setProperty('PAY18_DISABLED_IDS', JSON.stringify(Array.from(set)));
}


/*************************************************
 * パクチーム
 *************************************************/
function pay18_cachePakIds_(masterMap) {

  PropertiesService
    .getScriptProperties()
    .setProperty(
      'PAY18_PAK_IDS',
      JSON.stringify(pay18_getPakMemberIds_(masterMap))
    );
}


function pay18_getPakMemberIds_(masterMap) {

  const ids = Object
    .keys(masterMap)
    .filter(id =>
      String(masterMap[id].smallGroup || '').trim() ===
      PAYMENT_V18.TEAM_SMALL_GROUP
    );

  /* 1239本人も含める */
  if (
    masterMap[PAYMENT_V18.TEAM_OWNER_ID] &&
    !ids.includes(PAYMENT_V18.TEAM_OWNER_ID)
  ) {
    ids.push(PAYMENT_V18.TEAM_OWNER_ID);
  }

  ids.sort((a, b) => pay18_codeKey_(a) - pay18_codeKey_(b));

  return ids;
}


/*************************************************
 * 元台帳HASH
 *************************************************/
function pay18_ledgerSourceHash_(context) {

  const rows = Object
    .keys(context.aggregate)
    .sort()
    .map(key => {

      const r = context.aggregate[key];

      return [
        r.key,
        r.month,
        r.id,
        r.name,
        r.largeGroup,
        r.smallGroup,
        r.wAmount
      ];
    });

  return pay18_hash_(['LEDGER_SOURCE', rows]);
}


/*************************************************
 * 既存台帳取得
 *
 * 手書きを残す
 *************************************************/
function pay18_readExistingLedger_(sheet, sourceAggregate) {

  const result = {
    autoByKey: {},
    carryByKey: {},
    manual: [],
    contactById: {}
  };

  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return result;
  }

  const values = sheet
    .getRange(1, 1, lastRow, sheet.getLastColumn())
    .getValues();

  const header = values[0].map(value => String(value || '').trim());

  const find = (...names) => {

    for (const name of names) {

      const index = header.indexOf(name);

      if (index >= 0) {
        return index;
      }
    }

    return -1;
  };

  const c = {
    month: find('支払月'),
    id: find('推薦者コード'),
    name: find('推薦者名'),
    large: find('大グループ'),
    small: find('小グループ'),
    w: find('W社支払額'),
    b: find('B社支払額', 'BANK社支払額'),
    contact: find('連絡グループ'),
    person: find('連絡先・担当', '連絡先・担当者'),
    guide: find('案内状況'),
    invoice: find('請求書'),
    status: find('支払状況'),
    date: find('支払日'),
    note: find('備考'),
    marker: find('管理種別'),
    protect: find('手動保護')
  };

  /* ★V18.8：支払月は表示文字で読む */
  const monthDisplay =
    c.month >= 0
      ? sheet.getRange(1, c.month + 1, lastRow, 1).getDisplayValues()
      : [];

  values.slice(1).forEach((row, rowIndex) => {

    const get = index => (index >= 0 ? row[index] : '');

    const rawMonth =
      c.month >= 0 ? monthDisplay[rowIndex + 1][0] : '';

    const normalizedMonth = pay18_month_(rawMonth);

    const record = {
      month: normalizedMonth,
      rawMonth: rawMonth,
      id: pay18_id_(get(c.id)),
      name: get(c.name),
      largeGroup: get(c.large),
      smallGroup: get(c.small),
      wAmount: get(c.w),
      bAmount: get(c.b),
      contact: get(c.contact),
      person: get(c.person),
      guide: get(c.guide),
      invoice: get(c.invoice),
      status: get(c.status),
      date: get(c.date),
      note: get(c.note),
      marker: String(get(c.marker) || '').trim(),
      protect: String(get(c.protect) || '').trim()
    };

    const hasData = [
      record.rawMonth,
      record.id,
      record.name,
      record.largeGroup,
      record.smallGroup,
      record.wAmount,
      record.bAmount,
      record.contact,
      record.person,
      record.guide,
      record.invoice,
      record.status,
      record.date,
      record.note
    ].some(value => value !== '' && value !== null);

    if (!hasData) {
      return;
    }

    /*********************************************
     * 今後ユーザーが手動追記した行だけは
     * MANUAL + USER_KEEP のみを最優先で永久保護。
     *********************************************/
    const isProtectedManual =
      record.marker === PAYMENT_V18.MANUAL &&
      record.protect === PAYMENT_V18.USER_KEEP;

    if (record.id) {

      if (!result.contactById[record.id]) {
        result.contactById[record.id] = {
          contact: '',
          person: ''
        };
      }

      if (record.contact) {
        result.contactById[record.id].contact = record.contact;
      }

      if (record.person) {
        result.contactById[record.id].person = record.person;
      }
    }

    /*
     * ★V18.9修正：誤った戻入のときに自動で作られた行・備考の掃除。
     * 備考が自動の文（【戻入】【返金】・繰越のみ）だけで、支払済・支払日・B社の入力が無い
     * MANUAL行は、手で作った行ではないので戻さない。残す行も自動の文は消す（毎回作り直す）。
     */
    if (/【(戻入|返金)】/.test(String(record.note || ''))) {

      const userNote = pay18_stripAdjustNote_(record.note)
        .replace('前月までの未払い繰越のみ（今月の新規発生なし）', '')
        .replace(/^\s*\/\s*|\s*\/\s*$/g, '')
        .trim();

      if (
        record.marker === PAYMENT_V18.MANUAL &&
        !userNote &&
        !pay18_isSettled_(record.status) &&
        !record.date &&
        (record.bAmount === '' || record.bAmount === null || Math.abs(pay18_num_(record.bAmount)) < 0.000001)
      ) {
        return;
      }

      record.note = pay18_stripAdjustNote_(record.note);
    }

    if (isProtectedManual) {

      result.manual.push({
        ...record,
        marker: PAYMENT_V18.MANUAL,
        protect: PAYMENT_V18.USER_KEEP
      });

      return;
    }

    /*********************************************
     * ★V18.9：AUTO行なのに支払月が読めない場合は、
     * 台帳を書き換えずに止める（支払月が消えて重複する事故の防止）。
     *********************************************/
    if (record.marker === PAYMENT_V18.AUTO && record.id && !normalizedMonth) {
      throw new Error(
        '支払管理台帳' + (rowIndex + 2) + '行目（推薦者コード' + record.id +
        '）の支払月「' + rawMonth + '」が読めません。台帳は変更していません。'
      );
    }

    /*********************************************
     * 月として成立しない旧行（例：2026.89）は戻さない
     *********************************************/
    if (rawMonth !== '' && rawMonth !== null && !normalizedMonth) {
      return;
    }

    const key =
      record.month && record.id
        ? record.month + '||' + record.id
        : '';

    /* キーなしの通常行は手動保持 */
    if (!key) {

      result.manual.push({
        ...record,
        marker: PAYMENT_V18.MANUAL,
        protect: PAYMENT_V18.USER_KEEP
      });

      return;
    }

    const source = sourceAggregate ? sourceAggregate[key] : null;

    /*********************************************
     * 元データに存在する月＋推薦者コードは
     * 「保護済みMANUAL以外」を1つのAUTO情報へ統合。
     *********************************************/
    if (source) {

      result.autoByKey[key] = pay18_mergeLedgerRecord_(
        result.autoByKey[key] || null,
        record
      );

      return;
    }

    /*********************************************
     * ★V18.9：繰越行（CARRY）は案内状況・備考などを
     * 次の再構築に引き継ぐ（行そのものは毎回作り直す）。
     *********************************************/
    if (record.marker === PAYMENT_V18.CARRY) {

      result.carryByKey[key] = pay18_mergeLedgerRecord_(
        result.carryByKey[key] || null,
        record
      );

      return;
    }

    /*********************************************
     * ★V18.8：元データにもう存在しないAUTO行のうち、
     * 支払済・支払日・備考・B社支払額のどれもない行は
     * 自動計算の残骸なので戻さない（例：2026.10が2026.1と誤読された行）。
     *********************************************/
    if (
      record.marker === PAYMENT_V18.AUTO &&
      !pay18_isSettled_(record.status) &&
      !record.date &&
      !pay18_stripAdjustNote_(record.note).trim() &&
      Math.abs(pay18_num_(record.bAmount)) < 0.000001
    ) {
      return;
    }

    /*********************************************
     * 元データにもう存在しない行は
     * 勝手に削除せずMANUAL + KEEPへ退避。
     *********************************************/
    result.manual.push({
      ...record,
      marker: PAYMENT_V18.MANUAL,
      protect: PAYMENT_V18.USER_KEEP
    });
  });

  return result;
}


/*************************************************
 * 既存台帳レコード統合
 *
 * W社支払額は元データを正とするため、
 * ここでは管理情報とB社支払額を救済する。
 *************************************************/
function pay18_mergeLedgerRecord_(base, incoming) {

  if (!base) {
    return { ...incoming };
  }

  [
    'name',
    'largeGroup',
    'smallGroup',
    'contact',
    'person',
    'guide',
    'invoice',
    'date'
  ].forEach(field => {

    if (!base[field] && incoming[field]) {
      base[field] = incoming[field];
    }
  });

  const baseBBlank =
    base.bAmount === '' ||
    base.bAmount === null ||
    base.bAmount === undefined;

  const incomingBBlank =
    incoming.bAmount === '' ||
    incoming.bAmount === null ||
    incoming.bAmount === undefined;

  if (baseBBlank && !incomingBBlank) {

    base.bAmount = incoming.bAmount;

  } else if (!baseBBlank && !incomingBBlank) {

    const a = pay18_num_(base.bAmount);

    const b = pay18_num_(incoming.bAmount);

    /***********************************************
     * 旧重複行に同じB社支払額が複製されていても
     * 二重加算しない。
     * 値が異なる場合は、支払済/支払日ありの行を優先。
     ***********************************************/
    if (Math.abs(a - b) > 0.000001) {

      const basePriority =
        (pay18_isSettled_(base.status) ? 2 : 0) +
        (base.date ? 1 : 0);

      const incomingPriority =
        (pay18_isSettled_(incoming.status) ? 2 : 0) +
        (incoming.date ? 1 : 0);

      if (incomingPriority > basePriority) {
        base.bAmount = incoming.bAmount;
      }
    }
  }

  if (pay18_isPaid_(incoming.status)) {

    base.status = incoming.status;

  } else if (!base.status && incoming.status) {

    base.status = incoming.status;
  }

  if (incoming.note) {

    const current = String(base.note || '').trim();

    const next = String(incoming.note || '').trim();

    if (!current) {

      base.note = next;

    } else if (
      next &&
      current !== next &&
      !current.split(' / ').includes(next)
    ) {

      base.note = current + ' / ' + next;
    }
  }

  return base;
}


/*************************************************
 * 台帳再構築
 *************************************************/
function pay18_rebuildLedger_(context) {

  let sheet = context.ss.getSheetByName(PAYMENT_V18.LEDGER_SHEET);

  if (!sheet) {
    sheet = context.ss.insertSheet(PAYMENT_V18.LEDGER_SHEET);
  }

  /* V18.5初回だけ、現在の支払管理台帳を丸ごとバックアップ */
  pay18_backupLedgerOnce_(context.ss, sheet);

  const old = pay18_readExistingLedger_(sheet, context.aggregate);

  const autoRows = Object
    .values(context.aggregate)
    .map(source => {

      const oldRow = old.autoByKey[source.key] || {};

      const contact = old.contactById[source.id] || {};

      return {
        month: source.month,
        id: source.id,
        name: source.name,
        largeGroup: source.largeGroup,
        smallGroup: source.smallGroup,

        /* W社支払額は必ず元データ集計を正とする */
        wAmount: source.wAmount,

        bAmount: oldRow.bAmount !== undefined ? oldRow.bAmount : '',
        contact: oldRow.contact || contact.contact || '',
        person: oldRow.person || contact.person || '',
        guide: oldRow.guide || '未案内',
        invoice: oldRow.invoice || '未',
        status: oldRow.status || '未払い',
        date: oldRow.date || '',
        note: pay18_mergeAdjustNote_(pay18_stripAdjustNote_(oldRow.note || ''), (context.adjustNotes || {})[source.key]),
        marker: PAYMENT_V18.AUTO,
        protect: ''
      };
    });

  autoRows.sort(pay18_compare_);

  /* ★手動行は永久保持 */
  const manualRows = old.manual.map(record => {

    const master = context.masterMap[record.id];

    if (master) {

      if (!record.name) {
        record.name = master.name;
      }

      if (!record.largeGroup) {
        record.largeGroup = master.largeGroup;
      }

      if (!record.smallGroup) {
        record.smallGroup = master.smallGroup;
      }
    }

    return {
      ...record,
      marker: PAYMENT_V18.MANUAL,
      protect: PAYMENT_V18.USER_KEEP
    };
  });

  const carryRows = pay18_buildCarryRows_([...autoRows, ...manualRows], old, context);

  const header = [
    '支払月',
    '推薦者コード',
    '推薦者名',
    '大グループ',
    '小グループ',
    'W社支払額',
    'B社支払額',
    '前月未払い繰越',
    '総支払額',
    '対応',
    '連絡グループ',
    '連絡先・担当',
    '案内状況',
    '請求書',
    '支払状況',
    '支払日',
    '備考',
    '最終更新',
    '管理種別',
    '手動保護'
  ];

  const now = new Date();

  const output = [header];

  /* ★V18.9：手動行も含めて支払月順に並べる（同じ月・同じ人ならAUTO行が先） */
  [...autoRows, ...manualRows, ...carryRows].sort(pay18_compare_).forEach(row => {

    output.push([
      row.month || '',
      row.id || '',
      row.name || '',
      row.largeGroup || '',
      row.smallGroup || '',
      row.wAmount !== undefined ? row.wAmount : '',
      row.bAmount !== undefined ? row.bAmount : '',
      '',
      '',
      '',
      row.contact || '',
      row.person || '',
      row.guide || '',
      row.invoice || '',
      row.status || '',
      row.date || '',
      row.note || '',
      now,
      row.marker || '',
      row.protect || ''
    ]);
  });

  pay18_ensureSheetSize_(sheet, Math.max(2, output.length), 20);

  const oldLastRow = sheet.getLastRow();

  if (oldLastRow > 0) {
    sheet.getRange(1, 1, oldLastRow, 20).clearContent();
  }

  /* ★V18.8：支払月の列は文字扱い（2026.10 が 2026.1 に化けないように） */
  sheet.getRange(1, 1, sheet.getMaxRows(), 1).setNumberFormat('@');

  sheet.getRange(1, 1, output.length, 20).setValues(output);

  try {
    sheet.hideColumns(19, 2);
  } catch (error) {}

  pay18_recalculateLedger_(sheet, null);

  pay18_ensureLedgerFormatting_(sheet);

  return pay18_buildLedgerState_(sheet);
}


/*************************************************
 * ★V18.9：繰越だけの人の最新月の行
 *
 * 最新月に行がなく、それより前の月が未払いのまま
 * （W社・B社のどちらかに金額あり）の人には、
 * 最新月に「繰越のみ」の行（W社0）を作る。
 * 前月未払い繰越・総支払額・対応は再計算で入る。
 * 案内状況・請求書・支払状況・支払日・備考・B社は次回以降も引き継ぐ。
 *************************************************/
function pay18_buildCarryRows_(rows, old, context) {

  let latestKey = 0;

  let latestMonth = '';

  rows.forEach(row => {

    const key = pay18_monthKey_(row.month);

    if (key > latestKey) {
      latestKey = key;
      latestMonth = row.month;
    }
  });

  if (!latestMonth) {
    return [];
  }

  const byId = {};

  rows.forEach(row => {

    if (!row.id || !row.month) {
      return;
    }

    const key = pay18_monthKey_(row.month);

    if (!byId[row.id]) {
      byId[row.id] = {};
    }

    if (!byId[row.id][key]) {
      byId[row.id][key] = [];
    }

    byId[row.id][key].push(row);
  });

  const carryRows = [];

  Object.keys(byId).forEach(id => {

    const monthMap = byId[id];

    if (monthMap[latestKey]) {
      return;
    }

    /* 直近から遡って、未払いの月にW社・B社の金額があるか */
    const keys = Object.keys(monthMap).map(Number).sort((a, b) => b - a);

    let hasUnpaid = false;

    for (const key of keys) {

      const entries = monthMap[key];

      if (entries.some(entry => pay18_isSettled_(entry.status))) {
        break;
      }

      if (entries.some(entry =>
        Math.abs(pay18_num_(entry.wAmount)) > 0.000001 ||
        Math.abs(pay18_num_(entry.bAmount)) > 0.000001
      )) {
        hasUnpaid = true;
        break;
      }
    }

    if (!hasUnpaid) {
      return;
    }

    const last = monthMap[keys[0]][0];

    const master = context.masterMap[id] || {};

    const kept = old.carryByKey[latestMonth + '||' + id] || {};

    const contact = old.contactById[id] || {};

    carryRows.push({
      month: latestMonth,
      id: id,
      name: master.name || last.name || '',
      largeGroup: master.largeGroup || last.largeGroup || '',
      smallGroup: master.smallGroup || last.smallGroup || '',
      wAmount: 0,
      bAmount: kept.bAmount !== undefined ? kept.bAmount : '',
      contact: kept.contact || contact.contact || '',
      person: kept.person || contact.person || '',
      guide: kept.guide || '未案内',
      invoice: kept.invoice || '未',
      status: kept.status || '未払い',
      date: kept.date || '',
      note: kept.note || '前月までの未払い繰越のみ（今月の新規発生なし）',
      marker: PAYMENT_V18.CARRY,
      protect: ''
    });
  });

  return carryRows;
}


/*************************************************
 * V18.5初回バックアップ
 *************************************************/
function pay18_backupLedgerOnce_(ss, sheet) {

  const props = PropertiesService.getScriptProperties();

  const key = 'PAY18_LEDGER_BACKUP_V185_DONE';

  if (props.getProperty(key) === '1') {
    return;
  }

  if (sheet && sheet.getLastRow() > 0) {

    try {

      const timezone =
        ss.getSpreadsheetTimeZone() ||
        Session.getScriptTimeZone() ||
        'Asia/Tokyo';

      const stamp = Utilities.formatDate(new Date(), timezone, 'yyyyMMdd_HHmmss');

      const backup = sheet.copyTo(ss);

      backup.setName('【バックアップ】支払管理台帳_' + stamp);

    } catch (error) {

      console.error('支払管理台帳バックアップ失敗: ' + error.message);
    }
  }

  props.setProperty(key, '1');
}


/*************************************************
 * H：前月未払い繰越
 * I：総支払額
 * J：対応
 *
 * ★V18.6修正③
 * 計算結果が変わらない場合は書き込みをスキップ。
 *************************************************/
function pay18_recalculateLedger_(sheet, targetIds) {

  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, 19).getValues();

  /* ★V18.8：支払月は表示文字で読む */
  const monthDisplay = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();

  let latestMonthKey = 0;

  values.forEach((row, index) => {

    const key = pay18_monthKey_(monthDisplay[index][0]);

    if (key > latestMonthKey) {
      latestMonthKey = key;
    }
  });

  const output = values.map(row => [row[7], row[8], row[9]]);

  const beforeJson = JSON.stringify(output);

  const byId = {};

  values.forEach((row, index) => {

    const id = pay18_id_(row[1]);

    const month = pay18_month_(monthDisplay[index][0]);

    if (!id || !month) {
      return;
    }

    if (targetIds && !targetIds.has(id)) {
      return;
    }

    if (!byId[id]) {
      byId[id] = {};
    }

    if (!byId[id][month]) {
      byId[id][month] = [];
    }

    byId[id][month].push({
      index: index,
      row: row
    });
  });

  Object.keys(byId).forEach(id => {

    const monthMap = byId[id];

    const months = Object
      .keys(monthMap)
      .sort((a, b) => pay18_monthKey_(a) - pay18_monthKey_(b));

    let outstanding = 0;

    months.forEach(month => {

      const entries = monthMap[month];

      const monthKey = pay18_monthKey_(month);

      const isPast = monthKey < latestMonthKey;

      const carry = outstanding;

      let unpaidBase = 0;

      let hasPaidRow = false;

      entries.forEach((entry, index) => {

        const row = entry.row;

        const w = pay18_num_(row[5]);

        const b = pay18_num_(row[6]);

        const base = w + b;

        const paid = pay18_isPaid_(row[14]);

        const noPayment = pay18_isNoPayment_(row[14]);

        const settled = paid || noPayment;

        if (settled) {
          hasPaidRow = true;
        }

        const rowCarry = noPayment ? 0 : (index === 0 ? carry : 0);

        const gross = noPayment ? 0 : base + rowCarry;

        let action;

        /* ★支払済を最優先 */
        if (paid) {

          action = '✓ 支払済';

        } else if (noPayment) {

          action = '支払なし';

        /*
         * ★マイナス金額も通常処理
         * プラス／マイナスに関係なく、
         * 繰越・未払い・今回支払としてそのまま扱う
         */
        } else if (Math.abs(rowCarry) > 0.000001) {

          action = '⚠ 繰越あり';

        } else if (isPast && Math.abs(base) > 0.000001) {

          action = '⚠ 未払い・繰越';

        /*
         * ★最新月の総額がマイナスなら支払いは発生しない
         * 金額はマイナスのまま次回へ繰越す
         */
        } else if (!isPast && gross < -0.000001) {

          action = '次回繰越';

        /*
         * ★V18.7：最新月の総額が手数料（$5）以下なら
         * 手数料は引かず、払出せずに次回へ繰越す
         */
        } else if (
          !isPast &&
          gross > 0.000001 &&
          Math.floor(gross + 0.000001) <= PAYMENT_V18.ADMIN_FEE
        ) {

          action = '次回繰越';

        } else if (!isPast && gross > 0.000001) {

          action = '今回支払';

        } else {

          action = '支払なし';
        }

        output[entry.index][0] = rowCarry;

        output[entry.index][1] = gross;

        output[entry.index][2] = action;

        if (!settled) {
          unpaidBase += base;
        }
      });

      /*
       * ★その月を「済」または「不要」にしたら
       * それまでの繰越も含めて清算済とみなす
       */
      if (hasPaidRow && Math.abs(unpaidBase) < 0.000001) {
        outstanding = 0;
      } else {
        outstanding = carry + unpaidBase;
      }
    });
  });

  /* ★変化がなければ書き込まない */
  if (JSON.stringify(output) !== beforeJson) {
    sheet.getRange(2, 8, output.length, 3).setValues(output);
  }
}


/*************************************************
 * 台帳集計
 *************************************************/
function pay18_buildLedgerState_(sheet) {

  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return {
      records: [],
      byCode: {}
    };
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, 19).getValues();

  /* ★V18.8：支払月は表示文字で読む */
  const monthDisplay = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();

  const monthly = {};

  rows.forEach((row, index) => {

    const month = pay18_month_(monthDisplay[index][0]);

    const id = pay18_id_(row[1]);

    if (!month || !id) {
      return;
    }

    const key = month + '||' + id;

    if (!monthly[key]) {

      monthly[key] = {
        month: month,
        id: id,
        name: String(row[2] || ''),
        w: 0,
        b: 0,
        carry: 0,
        gross: 0,
        action: '',
        status: ''
      };
    }

    const item = monthly[key];

    item.w += pay18_num_(row[5]);

    item.b += pay18_num_(row[6]);

    const carry = pay18_num_(row[7]);

    if (Math.abs(carry) > Math.abs(item.carry)) {
      item.carry = carry;
    }

    const action = String(row[9] || '');

    if (action.includes('繰越')) {

      item.action = action;

    } else if (action === '要確認' && !item.action.includes('繰越')) {

      item.action = action;

    } else if (action === '✓ 支払済' && !item.action) {

      item.action = action;

    } else if (!item.action) {

      item.action = action;
    }

    if (pay18_isPaid_(row[14])) {
      item.status = '済';
    }
  });

  Object.values(monthly).forEach(item => {
    item.gross = item.w + item.b + item.carry;
  });

  const byCode = {};

  Object.values(monthly).forEach(item => {

    if (!byCode[item.id]) {
      byCode[item.id] = [];
    }

    byCode[item.id].push(item);
  });

  Object.keys(byCode).forEach(id => {
    byCode[id].sort((a, b) => pay18_monthKey_(a.month) - pay18_monthKey_(b.month));
  });

  return {
    records: Object.values(monthly),
    byCode: byCode
  };
}


/*************************************************
 * 個別支払集計
 *
 * 小数点以下切り捨て
 * $5手数料
 *
 * ★V18.7修正
 * ・旧版は W社／B社／繰越 を「それぞれ」切り捨ててから
 *   合計していたため、1ドル少ない（マイナスB社があると
 *   1ドル多い）払出額になっていた。
 * ・各項目はセント単位に丸めるだけにして、
 *   切り捨ては合計（支払総額）に対して1回だけ行う。
 * ・計算誤差（1943.9999…）で1ドル減らないよう補正。
 * ・マイナスは従来どおり：手数料なし・マイナスのまま繰越表示。
 *************************************************/
function pay18_calcNotice_(rows) {

  if (!rows || !rows.length) {
    return {
      latest: null,
      w: 0,
      b: 0,
      carry: 0,
      gross: 0,
      fee: 0,
      payout: 0
    };
  }

  const sorted = rows
    .slice()
    .sort((a, b) => pay18_monthKey_(a.month) - pay18_monthKey_(b.month));

  const latest = sorted[sorted.length - 1];

  const w = pay18_cents_(latest.w);

  const b = pay18_cents_(latest.b);

  const carry = pay18_cents_(latest.carry);

  const total = pay18_cents_(w + b + carry);

  /*
   * 小数点以下切り捨て（合計に対して1回だけ）
   * プラスは小さい方へ、マイナスは0の方へ切り捨て（旧版と同じ向き）
   */
  const gross =
    total >= 0
      ? Math.floor(total + 0.000001)
      : Math.ceil(total - 0.000001);

  /*
   * ★V18.7：支払総額が手数料（$5）以下なら
   * 手数料は引かず、今回は払出0（全額を次回へ繰越）
   */
  if (gross > 0 && gross <= PAYMENT_V18.ADMIN_FEE) {
    return {
      latest: latest,
      w: w,
      b: b,
      carry: carry,
      gross: gross,
      fee: 0,
      payout: 0
    };
  }

  const fee = gross > 0 ? PAYMENT_V18.ADMIN_FEE : 0;

  return {
    latest: latest,
    w: w,
    b: b,
    carry: carry,
    gross: gross,
    fee: fee,
    payout: gross - fee
  };
}


/*************************************************
 * ★V18.7追加：セント単位に丸める（計算誤差の除去）
 *************************************************/
function pay18_cents_(value) {

  return Math.round(pay18_num_(value) * 100) / 100;
}


/*************************************************
 * 支払いまとめ
 *************************************************/
function pay18_updateMainSummary_(ss, ledgerState, forceWrite) {

  let sheet = ss.getSheetByName(PAYMENT_V18.MAIN_SUMMARY_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(PAYMENT_V18.MAIN_SUMMARY_SHEET);
  }

  const months = [
    ...new Set(ledgerState.records.map(r => r.month))
  ]
    .filter(Boolean)
    .sort((a, b) => pay18_monthKey_(a) - pay18_monthKey_(b));

  const ids = Object
    .keys(ledgerState.byCode)
    .sort((a, b) => pay18_codeKey_(a) - pay18_codeKey_(b));

  const header = [
    '推薦者コード',
    '推薦者名',
    ...months,
    '最新月',
    '今回払出額',
    '対応'
  ];

  const output = [header];

  ids.forEach(id => {

    const rows = ledgerState.byCode[id];

    const latest = rows[rows.length - 1];

    const notice = pay18_calcNotice_(rows);

    const map = {};

    rows.forEach(row => {
      map[row.month] = row.gross;
    });

    const result = [id, latest.name || ''];

    months.forEach(month => {
      result.push(map[month] !== undefined ? map[month] : '');
    });

    result.push(latest.month, notice.payout, latest.action);

    output.push(result);
  });

  const props = PropertiesService.getScriptProperties();

  const hash = pay18_hash_(['MAIN_SUMMARY', output]);

  if (!forceWrite && props.getProperty('PAY18_MAIN_HASH') === hash) {
    return;
  }

  pay18_ensureSheetSize_(sheet, Math.max(2, output.length), header.length);

  const oldLast = sheet.getLastRow();

  if (oldLast > 0) {
    sheet
      .getRange(1, 1, oldLast, Math.max(header.length, sheet.getLastColumn()))
      .clearContent();
  }

  /* ★V18.8：月の見出しと「最新月」列は文字扱い（2026.10 を 2026.1 にしない） */
  sheet.getRange(1, 1, 1, header.length).setNumberFormat('@');

  sheet
    .getRange(1, months.length + 3, Math.max(2, output.length), 1)
    .setNumberFormat('@');

  sheet.getRange(1, 1, output.length, header.length).setValues(output);

  sheet.setFrozenRows(1);

  sheet.setFrozenColumns(2);

  sheet
    .getRange(1, 1, 1, header.length)
    .setBackground('#4472C4')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');

  if (output.length > 1) {

    if (months.length > 0) {
      sheet
        .getRange(2, 3, output.length - 1, months.length)
        .setNumberFormat('#,##0.00');
    }

    sheet
      .getRange(2, months.length + 4, output.length - 1, 1)
      .setNumberFormat('#,##0');
  }

  props.setProperty('PAY18_MAIN_HASH', hash);
}


/*************************************************
 * 個別ファイル1枚目
 *************************************************/
function pay18_writeDetail_(target, publicHeader, internalRows, hiddenColumns, props) {

  let sheet = target.getSheetByName(PAYMENT_V18.DETAIL_SHEET);

  if (!sheet) {
    sheet = target.insertSheet(PAYMENT_V18.DETAIL_SHEET, 0);
  }

  if (sheet.getIndex() !== 1) {

    try {

      target.setActiveSheet(sheet);

      target.moveActiveSheet(1);

    } catch (error) {}
  }

  pay18_writeDetailValues_(sheet, publicHeader, internalRows);

  pay18_ensureDetailFormatting_(target, sheet, props, 'NORMAL');

  pay18_applyVisibility_(sheet, hiddenColumns);
}


/*************************************************
 * 外部共有明細
 *
 * ★A:Rのみ
 *************************************************/
function pay18_writeDetailValues_(sheet, publicHeader, internalRows) {

  if (!Array.isArray(publicHeader)) {
    throw new Error('publicHeaderが取得できません。');
  }

  if (!Array.isArray(internalRows)) {
    internalRows = [];
  }

  const safeHeader = publicHeader.slice(0, 18);

  const safeRows = internalRows
    /* ★V18.9：支払倍率も今回支払額も空欄の行（金額のない未完成の行）は外部に出さない */
    .filter(row =>
      Array.isArray(row) &&
      !(String(row[12] === undefined ? '' : row[12]).trim() === '' &&
        String(row[13] === undefined ? '' : row[13]).trim() === '')
    )
    .map(row => {

    const out = row.slice(0, 18);

    /* ★V18.9：外部用は備考①を短い文にする */
    out[15] = pay18_publicNote_(out[15]);

    /* 実質紹介料率0%で今回0円の行は「支払対象」と紛らわしいので書き換え */
    if (
      pay18_num_(out[10]) === 0 &&
      pay18_num_(out[13]) === 0 &&
      String(out[15] || '').indexOf('今回支払い対象') === 0
    ) {
      out[15] = '支払なし（この契約のあなたの実質紹介料率は0%）';
    }

    return out;
  });

  const output = [safeHeader, ...safeRows];

  pay18_ensureSheetSize_(sheet, Math.max(2, output.length), 21);

  const previousLast = Math.max(sheet.getLastRow(), output.length);

  /* ★旧S/Tグループ情報削除 */
  sheet
    .getRange(1, 19, Math.max(2, previousLast), 3)
    .clearContent();

  /* A:R */
  sheet.getRange(1, 1, output.length, 18).setValues(output);

  if (previousLast > output.length) {
    sheet
      .getRange(output.length + 1, 1, previousLast - output.length, 18)
      .clearContent();
  }

  if (safeRows.length > 0) {

    const formatRow = [
      '0.00%',      // I
      '0.00%',      // J
      '#,##0.00',   // K
      '@',          // L
      '0',          // M
      '#,##0.00',   // N
      '@',          // O
      '@',          // P
      '@',          // Q
      '@'           // R
    ];

    sheet
      .getRange(2, 9, safeRows.length, 10)
      .setNumberFormats(
        Array.from({ length: safeRows.length }, () => formatRow.slice())
      );
  }

  /* Sだけ最終更新 */
  sheet.getRange('S1:S2').setValues([['最終更新'], [new Date()]]);

  sheet.getRange('S2').setNumberFormat('yyyy/mm/dd HH:mm:ss');

  /* T/Uは空 */
  sheet
    .getRange(1, 20, Math.max(2, previousLast), 2)
    .clearContent();
}


/*************************************************
 * 個別2枚目
 *************************************************/
function pay18_writeNotice_(target, id, ledgerRows, props) {

  let sheet = target.getSheetByName(PAYMENT_V18.NOTICE_SHEET);

  if (!sheet) {
    sheet = target.insertSheet(PAYMENT_V18.NOTICE_SHEET);
  }

  if (sheet.getIndex() !== 2) {

    try {

      target.setActiveSheet(sheet);

      target.moveActiveSheet(2);

    } catch (error) {}
  }

  pay18_ensureNoticeDesign_(target, sheet, props);

  const notice = pay18_calcNotice_(ledgerRows);

  const latest = notice.latest;

  sheet.getRange('B3:B4').setValues([
    [id],
    [latest ? latest.name : '']
  ]);

  sheet
    .getRange('E3')
    .setNumberFormat('@')
    .setValue(latest ? pay18_monthLabel_(latest.month) : '');

  sheet.getRange('E6:E11').setValues([
    [notice.w],
    [notice.b],
    [notice.carry],
    [notice.gross],
    [-notice.fee],
    [notice.payout]
  ]);
}


/*************************************************
 * 支払集計デザイン
 *************************************************/
function pay18_ensureNoticeDesign_(target, sheet, props) {

  const key = 'PAY18_NOTICE_FMT_' + target.getId();

  if (props.getProperty(key) === PAYMENT_V18.NOTICE_FORMAT_VERSION) {
    return;
  }

  pay18_ensureSheetSize_(sheet, 16, 5);

  const area = sheet.getRange('A1:E15');

  area.breakApart();

  area.clear();

  sheet.setHiddenGridlines(true);

  sheet
    .getRange('A1:E1')
    .merge()
    .setValue('お支払い明細')
    .setBackground('#244062')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setFontSize(16)
    .setHorizontalAlignment('center');

  sheet.getRange('A3').setValue('推薦者コード');

  sheet.getRange('A4').setValue('推薦者名');

  sheet.getRange('D3').setValue('支払月');

  sheet
    .getRange('A3:A4')
    .setBackground('#D9EAF7')
    .setFontWeight('bold');

  sheet
    .getRange('D3')
    .setBackground('#D9EAF7')
    .setFontWeight('bold');

  const labels = [
    'W社支払額',
    'B社支払額',
    '前月までの未払い繰越',
    '支払総額',
    '事務手数料',
    '今回払出額'
  ];

  labels.forEach((label, index) => {
    sheet
      .getRange(6 + index, 1, 1, 4)
      .merge()
      .setValue(label);
  });

  sheet.getRange('A6:E8').setBackground('#F7F9FB');

  sheet
    .getRange('A9:E9')
    .setBackground('#DDEBF7')
    .setFontWeight('bold');

  sheet.getRange('A10:E10').setBackground('#FFF2CC');

  sheet
    .getRange('A11:E11')
    .setBackground('#E2F0D9')
    .setFontWeight('bold')
    .setFontSize(16);

  sheet
    .getRange('E6:E11')
    .setNumberFormat('$#,##0;-$#,##0')
    .setHorizontalAlignment('right')
    .setFontWeight('bold')
    .setFontSize(12);

  /*
   * ★V18.7：W社／B社／繰越はセント単位で表示
   * （足し算が支払総額と一致するように）
   */
  sheet
    .getRange('E6:E8')
    .setNumberFormat('$#,##0.00;-$#,##0.00');

  sheet
    .getRange('A13:E13')
    .merge()
    .setValue('※支払総額の小数点以下を切り捨て、事務手数料 $5 を差し引いております。')
    .setFontSize(9)
    .setFontColor('#666666');

  sheet
    .getRange('A1:E13')
    .setFontFamily('Arial')
    .setVerticalAlignment('middle');

  sheet
    .getRange('A6:E11')
    .setBorder(true, true, true, true, true, true);

  sheet.setConditionalFormatRules([
    SpreadsheetApp
      .newConditionalFormatRule()
      .whenFormulaSatisfied('=ABS($E$8)>0')
      .setBackground('#F4CCCC')
      .setFontColor('#9C0006')
      .setBold(true)
      .setRanges([sheet.getRange('A8:E8')])
      .build()
  ]);

  sheet.setColumnWidth(1, 140);

  sheet.setColumnWidth(2, 230);

  sheet.setColumnWidth(3, 35);

  sheet.setColumnWidth(4, 195);

  sheet.setColumnWidth(5, 150);

  sheet.setFrozenRows(1);

  props.setProperty(key, PAYMENT_V18.NOTICE_FORMAT_VERSION);
}


/*************************************************
 * ===============================================
 * パクさんチーム
 * ===============================================
 *************************************************/


/*************************************************
 * 1239チーム更新
 *************************************************/
function pay18_updatePakTeamWorkbook_(context, ledgerState, props, forceAll) {

  const ownerId = PAYMENT_V18.TEAM_OWNER_ID;

  const owner = context.masterMap[ownerId];

  if (!owner || !owner.folderId || !owner.autoShare) {
    return;
  }

  const memberIds = pay18_getPakMemberIds_(context.masterMap);

  if (memberIds.length === 0) {
    return;
  }

  const latestMonth = pay18_getGlobalLatestMonth_(ledgerState);

  const signature = memberIds.map(id => {

    const master = context.masterMap[id] || {};

    const detailRows = context.groups[id] || [];

    const ledgerRows = ledgerState.byCode[id] || [];

    return [
      id,
      master.name || '',
      pay18_teamDetailHash_(id, context.publicHeader, detailRows, context.hiddenColumns),
      pay18_noticeHash_(id, ledgerRows)
    ];
  });

  const teamHash = pay18_hash_(['PAK_TEAM', latestMonth, signature]);

  const oldHash = props.getProperty('PAY18_PAK_TEAM_HASH');

  const cached = props.getProperty('PAY18_TARGET_' + ownerId);

  if (!forceAll && oldHash === teamHash && cached) {
    return;
  }

  const target = pay18_getTargetSS_(ownerId, owner, props);

  const desiredTabs = new Set();

  memberIds.forEach(id => {

    /* 1239本人は通常の支払明細 */
    if (id === ownerId) {
      return;
    }

    const tabName = pay18_teamTabName_(id);

    desiredTabs.add(tabName);

    const rows = context.groups[id] || [];

    const hash = pay18_teamDetailHash_(id, context.publicHeader, rows, context.hiddenColumns);

    const key = 'PAY18_TEAM_MEMBER_HASH_' + id;

    const oldMemberHash = props.getProperty(key);

    let sheet = target.getSheetByName(tabName);

    if (forceAll || !sheet || hash !== oldMemberHash) {

      if (!sheet) {
        sheet = target.insertSheet(tabName);
      }

      /* ★グループ情報は出さない */
      pay18_writeDetailValues_(sheet, context.publicHeader, rows);

      pay18_ensureDetailFormatting_(target, sheet, props, 'TEAM_' + id);

      pay18_applyVisibility_(sheet, context.hiddenColumns);

      props.setProperty(key, hash);
    }
  });

  /* チームから外れた旧タブ削除 */
  target.getSheets().forEach(sheet => {

    const name = sheet.getName();

    if (
      name.startsWith(PAYMENT_V18.TEAM_TAB_PREFIX) &&
      !desiredTabs.has(name)
    ) {
      target.deleteSheet(sheet);
    }
  });

  pay18_writePakTeamIndex_(target, memberIds, context, ledgerState, latestMonth, props);

  props.setProperty('PAY18_PAK_TEAM_HASH', teamHash);
}


/*************************************************
 * パクチーム一覧
 *************************************************/
function pay18_writePakTeamIndex_(target, memberIds, context, ledgerState, latestMonth, props) {

  let sheet = target.getSheetByName(PAYMENT_V18.TEAM_INDEX_SHEET);

  if (!sheet) {
    sheet = target.insertSheet(PAYMENT_V18.TEAM_INDEX_SHEET);
  }

  /*
   * ★★★重要★★★
   * 過去に2列固定が残っていても
   * A1:K1を結合できるよう
   * 結合前に必ず列固定を解除する。
   */
  sheet.setFrozenColumns(0);

  if (sheet.getIndex() !== 3) {

    try {

      target.setActiveSheet(sheet);

      target.moveActiveSheet(3);

    } catch (error) {}
  }

  const data = [];

  let totalPlans = 0;
  let latestPlans = 0;
  let totalW = 0;
  let totalB = 0;
  let totalCarry = 0;
  let totalGross = 0;

  memberIds.forEach(id => {

    const master = context.masterMap[id] || {};

    const detailRows = context.groups[id] || [];

    const ledgerRows = ledgerState.byCode[id] || [];

    const counts = pay18_getContractCounts_(detailRows, latestMonth);

    totalPlans += counts.totalPlans;

    latestPlans += counts.latestPaymentPlans;

    const latest = ledgerRows.length ? ledgerRows[ledgerRows.length - 1] : null;

    const w = latest ? pay18_num_(latest.w) : 0;

    const b = latest ? pay18_num_(latest.b) : 0;

    const carry = latest ? pay18_num_(latest.carry) : 0;

    const gross = latest ? pay18_num_(latest.gross) : 0;

    totalW += w;

    totalB += b;

    totalCarry += carry;

    totalGross += gross;

    data.push({
      id: id,
      name: master.name || (latest ? latest.name : ''),
      totalPlans: counts.totalPlans,
      latestPlans: counts.latestPaymentPlans,
      latestMonth: latest ? latest.month : '',
      w: w,
      b: b,
      carry: carry,
      gross: gross,
      action: latest ? latest.action : ''
    });
  });

  pay18_ensureSheetSize_(sheet, Math.max(20, data.length + 8), 11);

  const oldLast = sheet.getLastRow();

  if (oldLast > 0) {
    sheet.getRange(1, 1, oldLast, 11).clearContent();
  }

  /* ★列固定解除済みなので安全 */
  sheet.getRange('A1:K1').breakApart();

  sheet
    .getRange('A1:K1')
    .merge()
    .setValue('パクさんチーム 支払・契約状況');

  sheet.getRange('A3:H5').setValues([
    [
      '基準支払月',
      pay18_monthLabel_(latestMonth),
      '',
      'チーム人数',
      memberIds.length,
      '',
      '保有プラン合計',
      totalPlans
    ],
    [
      '最新月支払対象プラン数',
      latestPlans,
      '',
      'W社支払額合計',
      totalW,
      '',
      'B社支払額合計',
      totalB
    ],
    [
      '前月未払い繰越合計',
      totalCarry,
      '',
      'チーム総支払額',
      totalGross,
      '',
      '',
      ''
    ]
  ]);

  const header = [
    '推薦者コード',
    '推薦者名',
    '保有プラン数',
    '最新月支払対象プラン数',
    '最新支払月',
    'W社支払額',
    'B社支払額',
    '前月未払い繰越',
    '総支払額',
    '対応',
    '明細'
  ];

  sheet.getRange(7, 1, 1, 11).setValues([header]);

  if (data.length > 0) {

    sheet
      .getRange(8, 1, data.length, 11)
      .setValues(
        data.map(item => [
          item.id,
          item.name,
          item.totalPlans,
          item.latestPlans,
          item.latestMonth,
          item.w,
          item.b,
          item.carry,
          item.gross,
          item.action,
          ''
        ])
      );

    /* 各人の明細タブへリンク */
    data.forEach((item, index) => {

      const detailSheet =
        item.id === PAYMENT_V18.TEAM_OWNER_ID
          ? target.getSheetByName(PAYMENT_V18.DETAIL_SHEET)
          : target.getSheetByName(pay18_teamTabName_(item.id));

      if (!detailSheet) {
        return;
      }

      sheet
        .getRange(8 + index, 11)
        .setFormula(
          '=HYPERLINK("#gid=' + detailSheet.getSheetId() + '","明細を見る")'
        );
    });
  }

  pay18_ensurePakTeamFormat_(target, sheet, props);
}


/*************************************************
 * 契約件数
 *************************************************/
function pay18_getContractCounts_(detailRows, latestMonth) {

  const total = new Set();

  const latest = new Set();

  detailRows.forEach(row => {

    const plan = String(row[0] || '').trim();

    if (!plan) {
      return;
    }

    total.add(plan);

    const month = pay18_month_(row[14]);

    const amount = pay18_num_(row[13]);

    if (month === latestMonth && Math.abs(amount) > 0.000001) {
      latest.add(plan);
    }
  });

  return {
    totalPlans: total.size,
    latestPaymentPlans: latest.size
  };
}


/*************************************************
 * パクタブ名
 *************************************************/
function pay18_teamTabName_(id) {

  return PAYMENT_V18.TEAM_TAB_PREFIX + pay18_id_(id);
}


/*************************************************
 * 全体最新月
 *************************************************/
function pay18_getGlobalLatestMonth_(ledgerState) {

  let result = '';
  let best = 0;

  ledgerState.records.forEach(row => {

    const key = pay18_monthKey_(row.month);

    if (key > best) {

      best = key;

      result = row.month;
    }
  });

  return result;
}


/*************************************************
 * パク個人明細HASH
 *************************************************/
function pay18_teamDetailHash_(id, publicHeader, internalRows, hidden) {

  const safeRows = internalRows.map(row =>
    Array.isArray(row) ? row.slice(0, 18) : Array(18).fill('')
  );

  return pay18_hash_([
    'TEAM_DETAIL',
    PAYMENT_V18.PUBLIC_DETAIL_VERSION,
    id,
    publicHeader,
    safeRows,
    pay18_visibilitySignature_(hidden)
  ]);
}


/*************************************************
 * 台帳編集時パク一覧高速更新
 *************************************************/
function pay18_fastUpdatePakTeamIndex_(ledgerState, affectedIds, props) {

  const raw = props.getProperty('PAY18_PAK_IDS');

  if (!raw) {

    props.deleteProperty('PAY18_PAK_TEAM_HASH');

    return;
  }

  let pakIds;

  try {
    pakIds = new Set(JSON.parse(raw));
  } catch (error) {
    return;
  }

  const relevant = Array
    .from(affectedIds)
    .some(id => pakIds.has(id));

  if (!relevant) {
    return;
  }

  const targetId = props.getProperty('PAY18_TARGET_' + PAYMENT_V18.TEAM_OWNER_ID);

  if (!targetId) {

    props.deleteProperty('PAY18_PAK_TEAM_HASH');

    return;
  }

  try {

    const target = SpreadsheetApp.openById(targetId);

    const sheet = target.getSheetByName(PAYMENT_V18.TEAM_INDEX_SHEET);

    if (!sheet || sheet.getLastRow() < 8) {

      props.deleteProperty('PAY18_PAK_TEAM_HASH');

      return;
    }

    const count = sheet.getLastRow() - 7;

    const ids = sheet
      .getRange(8, 1, count, 1)
      .getDisplayValues()
      .flat();

    affectedIds.forEach(id => {

      if (!pakIds.has(id)) {
        return;
      }

      const index = ids.findIndex(value => pay18_id_(value) === id);

      if (index < 0) {
        return;
      }

      const rows = ledgerState.byCode[id] || [];

      if (!rows.length) {
        return;
      }

      const latest = rows[rows.length - 1];

      sheet
        .getRange(8 + index, 5, 1, 6)
        .setValues([[
          latest.month,
          latest.w,
          latest.b,
          latest.carry,
          latest.gross,
          latest.action
        ]]);
    });

    props.deleteProperty('PAY18_PAK_TEAM_HASH');

  } catch (error) {

    props.deleteProperty('PAY18_PAK_TEAM_HASH');
  }
}


/*************************************************
 * パクチーム一覧書式
 *************************************************/
function pay18_ensurePakTeamFormat_(target, sheet, props) {

  const key = 'PAY18_TEAM_FMT_' + target.getId();

  /* ★結合セルエラー防止 必ず0列固定 */
  sheet.setFrozenColumns(0);

  if (props.getProperty(key) === PAYMENT_V18.TEAM_FORMAT_VERSION) {
    return;
  }

  sheet
    .getRange('A1:K1')
    .setBackground('#244062')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setFontSize(15)
    .setHorizontalAlignment('center');

  ['A3', 'D3', 'G3', 'A4', 'D4', 'G4', 'A5', 'D5', 'G5'].forEach(cell => {
    sheet
      .getRange(cell)
      .setBackground('#D9EAF7')
      .setFontWeight('bold');
  });

  sheet
    .getRange(7, 1, 1, 11)
    .setBackground('#4472C4')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  const rows = Math.max(1, sheet.getMaxRows() - 7);

  sheet.getRange(8, 6, rows, 4).setNumberFormat('#,##0.00');

  const dataRange = sheet.getRange(8, 1, rows, 11);

  sheet.setConditionalFormatRules([

    SpreadsheetApp
      .newConditionalFormatRule()
      .whenFormulaSatisfied('=OR($J8="⚠ 未払い・繰越",$J8="⚠ 繰越あり")')
      .setBackground('#FDEDEC')
      .setRanges([dataRange])
      .build(),

    SpreadsheetApp
      .newConditionalFormatRule()
      .whenFormulaSatisfied('=$J8="✓ 支払済"')
      .setBackground('#EAF4E3')
      .setRanges([dataRange])
      .build(),

    SpreadsheetApp
      .newConditionalFormatRule()
      .whenFormulaSatisfied('=$J8="今回支払"')
      .setBackground('#FFF9E6')
      .setRanges([dataRange])
      .build()
  ]);

  /* 行だけ固定。列は固定しない。 */
  sheet.setFrozenRows(7);

  sheet.setFrozenColumns(0);

  sheet.setColumnWidth(1, 110);

  sheet.setColumnWidth(2, 220);

  sheet.setColumnWidth(3, 100);

  sheet.setColumnWidth(4, 160);

  sheet.setColumnWidth(5, 100);

  sheet.setColumnWidths(6, 4, 120);

  sheet.setColumnWidth(10, 130);

  sheet.setColumnWidth(11, 100);

  props.setProperty(key, PAYMENT_V18.TEAM_FORMAT_VERSION);
}


/*************************************************
 * 台帳書式
 *************************************************/
function pay18_ensureLedgerFormatting_(sheet) {

  const props = PropertiesService.getScriptProperties();

  const key = 'PAY18_LEDGER_FMT';

  if (props.getProperty(key) === PAYMENT_V18.LEDGER_FORMAT_VERSION) {
    return;
  }

  pay18_ensureSheetSize_(sheet, Math.max(2, sheet.getMaxRows()), 20);

  try {
    sheet.hideColumns(19, 2);
  } catch (error) {}

  sheet.setFrozenRows(1);

  const rows = Math.max(1, sheet.getMaxRows() - 1);

  sheet.getRange(2, 6, rows, 2).setNumberFormat('#,##0.00');

  sheet.getRange(2, 8, rows, 1).setNumberFormat('#,##0.00;-#,##0.00;;@');

  sheet.getRange(2, 9, rows, 1).setNumberFormat('#,##0.00;-#,##0.00;0.00');

  sheet
    .getRange(1, 1, 1, 18)
    .setBackground('#4472C4')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  const allRange = sheet.getRange(2, 1, rows, 18);

  const carryRange = sheet.getRange(2, 8, rows, 1);

  sheet.setConditionalFormatRules([

    SpreadsheetApp
      .newConditionalFormatRule()
      .whenFormulaSatisfied('=OR($J2="⚠ 未払い・繰越",$J2="⚠ 繰越あり")')
      .setBackground('#FDEDEC')
      .setRanges([allRange])
      .build(),

    SpreadsheetApp
      .newConditionalFormatRule()
      .whenFormulaSatisfied('=$J2="✓ 支払済"')
      .setBackground('#EAF4E3')
      .setRanges([allRange])
      .build(),

    SpreadsheetApp
      .newConditionalFormatRule()
      .whenFormulaSatisfied('=$J2="今回支払"')
      .setBackground('#FFF9E6')
      .setRanges([allRange])
      .build(),

    SpreadsheetApp
      .newConditionalFormatRule()
      .whenFormulaSatisfied('=ABS($H2)>0.000001')
      .setFontColor('#C00000')
      .setBold(true)
      .setRanges([carryRange])
      .build()
  ]);

  const guide = SpreadsheetApp
    .newDataValidation()
    .requireValueInList(['未案内', '案内済', '確認中', '不要'], true)
    .setAllowInvalid(true)
    .build();

  const invoice = SpreadsheetApp
    .newDataValidation()
    .requireValueInList(['未', '依頼済', '受領済', '不要'], true)
    .setAllowInvalid(true)
    .build();

  const status = SpreadsheetApp
    .newDataValidation()
    .requireValueInList(['未払い', '支払予定', '済', '保留'], true)
    .setAllowInvalid(true)
    .build();

  sheet.getRange(2, 13, rows, 1).setDataValidation(guide);

  sheet.getRange(2, 14, rows, 1).setDataValidation(invoice);

  sheet.getRange(2, 15, rows, 1).setDataValidation(status);

  const filter = sheet.getFilter();

  if (filter) {
    filter.remove();
  }

  sheet
    .getRange(1, 1, sheet.getMaxRows(), 18)
    .createFilter();

  props.setProperty(key, PAYMENT_V18.LEDGER_FORMAT_VERSION);
}


/*************************************************
 * 個別明細書式
 *************************************************/
function pay18_ensureDetailFormatting_(target, sheet, props, type) {

  const key = 'PAY18_DETAIL_FMT_' + target.getId() + '_' + type;

  if (props.getProperty(key) === PAYMENT_V18.DETAIL_FORMAT_VERSION) {
    return;
  }

  sheet.setFrozenRows(1);

  /* A:R */
  sheet
    .getRange(1, 1, 1, 18)
    .setFontWeight('bold')
    .setBackground('#D9EAD3');

  /* Sのみ */
  sheet
    .getRange('S1')
    .setFontWeight('bold')
    .setBackground('#F3F3F3');

  const filter = sheet.getFilter();

  if (filter) {
    filter.remove();
  }

  sheet
    .getRange(1, 1, sheet.getMaxRows(), 18)
    .createFilter();

  try {
    sheet.showColumns(19);
  } catch (error) {}

  try {
    sheet.hideColumns(20, 2);
  } catch (error) {}

  props.setProperty(key, PAYMENT_V18.DETAIL_FORMAT_VERSION);
}


/*************************************************
 * N:R表示非表示
 *************************************************/
function pay18_applyVisibility_(sheet, hidden) {

  if (!hidden) {
    return;
  }

  for (let col = 14; col <= 18; col++) {

    try {

      if (hidden[col]) {
        sheet.hideColumns(col);
      } else {
        sheet.showColumns(col);
      }

    } catch (error) {}
  }

  try {
    sheet.showColumns(19);
  } catch (error) {}

  try {
    sheet.hideColumns(20, 2);
  } catch (error) {}
}


/*************************************************
 * 配布先Spreadsheet
 *************************************************/
function pay18_getTargetSS_(id, master, props) {

  const targetKey = 'PAY18_TARGET_' + id;

  const folderKey = 'PAY18_FOLDER_' + id;

  const oldFolder = props.getProperty(folderKey);

  if (oldFolder && oldFolder !== master.folderId) {
    props.deleteProperty(targetKey);
  }

  props.setProperty(folderKey, master.folderId);

  const cached = props.getProperty(targetKey);

  if (cached) {

    try {
      return SpreadsheetApp.openById(cached);
    } catch (error) {
      props.deleteProperty(targetKey);
    }
  }

  const folder = DriveApp.getFolderById(master.folderId);

  const files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);

  const candidates = [];

  while (files.hasNext()) {
    candidates.push(files.next());
  }

  const preferred = candidates.find(file => file.getName().includes('支払明細'));

  let target;

  if (preferred) {

    target = SpreadsheetApp.openById(preferred.getId());

  } else if (candidates.length === 1) {

    target = SpreadsheetApp.openById(candidates[0].getId());

  } else {

    target = SpreadsheetApp.create(PAYMENT_V18.FILE_PREFIX + id);

    DriveApp
      .getFileById(target.getId())
      .moveTo(folder);

    target
      .getSheets()[0]
      .setName(PAYMENT_V18.DETAIL_SHEET);
  }

  props.setProperty(targetKey, target.getId());

  return target;
}


/*************************************************
 * HASH
 *************************************************/
function pay18_detailHash_(id, master, publicHeader, internalRows, hidden) {

  const safeRows = internalRows.map(row =>
    Array.isArray(row) ? row.slice(0, 18) : Array(18).fill('')
  );

  return pay18_hash_([
    'DETAIL',
    PAYMENT_V18.PUBLIC_DETAIL_VERSION,
    id,
    master.folderId,
    master.name,
    pay18_visibilitySignature_(hidden),
    publicHeader,
    safeRows
  ]);
}


function pay18_noticeHash_(id, rows) {

  return pay18_hash_([
    'NOTICE',
    id,
    rows.map(row => [
      row.month,
      row.name,
      row.w,
      row.b,
      row.carry,
      row.gross,
      row.action,
      row.status
    ])
  ]);
}


function pay18_visibilitySignature_(hidden) {

  let result = '';

  for (let col = 14; col <= 18; col++) {
    result += hidden[col] ? '1' : '0';
  }

  return result;
}


/*************************************************
 * 支払済
 *************************************************/
function pay18_isPaid_(value) {

  const text = String(value || '').trim();

  return (
    text === '済' ||
    text === '支払済' ||
    text === '支払済み'
  );
}


/*************************************************
 * 支払不要
 *
 * 「不要」は翌月へ繰り越さない。
 *************************************************/
function pay18_isNoPayment_(value) {

  const text = String(value || '').trim();

  return (
    text === '不要' ||
    text === '支払不要' ||
    text === '支払い不要'
  );
}


/*************************************************
 * 清算済み判定
 *************************************************/
function pay18_isSettled_(value) {

  return pay18_isPaid_(value) || pay18_isNoPayment_(value);
}


/*************************************************
 * 月
 *************************************************/
function pay18_monthLabel_(value) {

  const month = pay18_month_(value);

  const match = String(month).match(/^(\d{4})\.(\d{1,2})$/);

  if (!match) {
    return String(month || '');
  }

  return match[1] + '年' + Number(match[2]) + '月';
}


function pay18_month_(value) {

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


function pay18_monthKey_(value) {

  const month = pay18_month_(value);

  const match = String(month).match(/^(\d{4})\.(\d{1,2})$/);

  if (!match) {
    return 0;
  }

  return Number(match[1]) * 100 + Number(match[2]);
}


/*************************************************
 * ID
 *************************************************/
function pay18_id_(value) {

  if (value === '' || value === null || value === undefined) {
    return '';
  }

  let text = String(value).trim();

  if (/^\d+\.0+$/.test(text)) {
    text = text.split('.')[0];
  }

  return text;
}


/*************************************************
 * 数値
 *************************************************/
function pay18_num_(value) {

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


/*************************************************
 * グループ
 *************************************************/
function pay18_cleanGroup_(value) {

  const text = String(
    value === null || value === undefined ? '' : value
  ).trim();

  return text === '0' ? '' : text;
}


/*************************************************
 * 台帳並び
 *************************************************/
function pay18_compare_(a, b) {

  const month = pay18_monthKey_(a.month) - pay18_monthKey_(b.month);

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

  return pay18_codeKey_(a.id) - pay18_codeKey_(b.id);
}


function pay18_codeKey_(value) {

  const num = Number(String(value).replace(/[^\d.-]/g, ''));

  return isNaN(num) ? 999999999 : num;
}


/*************************************************
 * サイズ
 *************************************************/
function pay18_ensureSheetSize_(sheet, rows, cols) {

  if (sheet.getMaxRows() < rows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
  }

  if (sheet.getMaxColumns() < cols) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), cols - sheet.getMaxColumns());
  }
}


/*************************************************
 * 元Spreadsheet
 *************************************************/
function pay18_getSourceSS_() {

  const props = PropertiesService.getScriptProperties();

  const id = props.getProperty('PAY18_SOURCE_SSID');

  if (id) {

    try {
      return SpreadsheetApp.openById(id);
    } catch (error) {
      props.deleteProperty('PAY18_SOURCE_SSID');
    }
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!ss) {
    throw new Error('setupPaymentSystemV18を先に実行してください。');
  }

  props.setProperty('PAY18_SOURCE_SSID', ss.getId());

  return ss;
}


/*************************************************
 * HASH
 *************************************************/
function pay18_hash_(value) {

  const text = PAYMENT_V18.VERSION + '|' + JSON.stringify(value);

  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text)
  );
}


/*************************************************
 * 過去キャッシュ移行
 *************************************************/
function pay18_migrateOldTargetCache_() {

  const props = PropertiesService.getScriptProperties();

  const all = props.getProperties();

  const migrations = [
    ['PAY17_TARGET_', 'PAY18_TARGET_'],
    ['PAY17_FOLDER_', 'PAY18_FOLDER_'],
    ['PAY16_TARGET_', 'PAY18_TARGET_'],
    ['PAY16_FOLDER_', 'PAY18_FOLDER_'],
    ['PAYSYS_TARGET_', 'PAY18_TARGET_']
  ];

  Object.keys(all).forEach(key => {

    migrations.forEach(pair => {

      const oldPrefix = pair[0];

      const newPrefix = pair[1];

      if (!key.startsWith(oldPrefix)) {
        return;
      }

      const id = key.replace(oldPrefix, '');

      const newKey = newPrefix + id;

      if (!props.getProperty(newKey)) {
        props.setProperty(newKey, all[key]);
      }
    });
  });
}


/*************************************************
 * トリガー
 *************************************************/
function setupPaymentV18Triggers() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!ss) {
    throw new Error('スプレッドシートを取得できません。');
  }

  const handlers = [
    'autoSyncPaymentV18OnEdit',
    'backupPaymentV18Sync',

    'autoSyncPaymentV17OnEdit',
    'backupPaymentV17Sync',

    'autoSyncPaymentV16OnEdit',
    'autoSyncPaymentV16OnChange',
    'backupPaymentV16Sync',

    'autoSyncPaymentV15OnEdit',
    'autoSyncPaymentV15OnChange',
    'backupPaymentV15Sync',

    'autoSyncPaymentV14OnEdit',
    'autoSyncPaymentV14OnChange',
    'backupPaymentV14Sync',

    'autoSyncPaymentV13OnEdit',
    'autoSyncPaymentV13OnChange',
    'backupPaymentV13Sync',

    'autoSyncPaymentOnEdit',
    'autoSyncPaymentOnChange',
    'backupPaymentSync',
    'backupPaymentAutoSync'
  ];

  ScriptApp
    .getProjectTriggers()
    .filter(trigger => handlers.includes(trigger.getHandlerFunction()))
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp
    .newTrigger('autoSyncPaymentV18OnEdit')
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  ScriptApp
    .newTrigger('backupPaymentV18Sync')
    .timeBased()
    .everyMinutes(5)
    .create();
}


/*************************************************
 * キャッシュリセット
 *************************************************/
function resetPaymentV18Cache() {

  const props = PropertiesService.getScriptProperties();

  const all = props.getProperties();

  Object.keys(all)
    .filter(key => key.startsWith('PAY18_'))
    .forEach(key => {

      if (key !== 'PAY18_SOURCE_SSID') {
        props.deleteProperty(key);
      }
    });
}
