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
function pay18_fullSync_(forceAll) {

  const lock = LockService.getScriptLock();

  if (!lock.tryLock(1000)) {
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

  const groups = {};
  const aggregate = {};

  const rowsInfo = [];

  all.slice(1).forEach((original, index) => {

    const row = original.slice(0, 20);

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
      rowNumber: index + 2,
      originalNote: String(original[15] || '')
    });
  });

  pay18_applyMinashiGuard_(rowsInfo);

  pay18_writeJudgeColumn_(source, all, rowsInfo, lastRow);

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

      if (!currentNote || currentNote.indexOf('今回支払い対象（みなし年払い）') === 0) {

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
      !String(record.note || '').trim() &&
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
        note: oldRow.note || '',
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

  const safeRows = internalRows.map(row =>
    Array.isArray(row) ? row.slice(0, 18) : Array(18).fill('')
  );

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
