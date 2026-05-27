import openpyxl
from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from collections import defaultdict
from datetime import datetime, date
import os

print("ファイル読み込み中...")

# ファイルパス
GOO_FILE    = '/root/.claude/uploads/2215fcf7-82dc-4187-95b7-601feb1fc13c/3995dc45-_Goo______________.xlsx'
CUST_FILE   = '/root/.claude/uploads/45dd6254-25c1-435c-8ade-6917ff429d36/e2e7edf4-______.xlsx'
INTRO_FILE  = '/root/.claude/uploads/45dd6254-25c1-435c-8ade-6917ff429d36/1cbfe42f-______.xlsx'
OUT_FILE    = '/home/user/test/Goo_運用委託費_ベースデータ.xlsx'

wb_goo   = openpyxl.load_workbook(GOO_FILE)
wb_cust  = openpyxl.load_workbook(CUST_FILE)
wb_intro = openpyxl.load_workbook(INTRO_FILE)
ws_goo   = wb_goo['InvestorsTrust']
ws_cust  = wb_cust['InvestorsTrust']
ws_intro = wb_intro['Sheet1']

# ─── 顧客マスター辞書 (プラン番号+商品コード) → 各種情報 ───
# key: (plan_no, prod_code)
# val: (seq, cust_name, intro_code, intro_name, status, inception_date)
cust_by_plan_prod = {}
cust_by_plan = defaultdict(list)  # プランのみで引く用

print("顧客マスター読み込み中...")
for row in ws_cust.iter_rows(min_row=3, max_row=ws_cust.max_row, values_only=True):
    plan = row[4]
    if not plan or plan == 'プラン番号':
        continue
    prod_full  = str(row[9]) if row[9] else ''
    prod_code  = prod_full.split(' - ')[0].strip() if prod_full else ''
    seq        = row[5] if row[5] else ''
    cust_name  = row[7] if row[7] else ''
    intro_code = row[0]
    intro_name = row[1] if row[1] else ''
    status     = row[8] if row[8] else ''
    inc_date   = row[11]  # 発効日
    if isinstance(inc_date, datetime):
        inc_date = inc_date.date()

    key = (plan, prod_code)
    if key not in cust_by_plan_prod:
        cust_by_plan_prod[key] = (seq, cust_name, intro_code, intro_name, status, inc_date)
    cust_by_plan[plan].append((seq, prod_code, cust_name, intro_code, intro_name, status, inc_date))

print(f"  顧客マスター: {len(cust_by_plan_prod)}キー ({len(cust_by_plan)}プラン)")

# ─── イントロデューサーマスター辞書 ───
# key: intro_code (int)
# val: {グループ, 小グループ, グループ名, 状態}
intro_master = {}
print("イントロデューサーマスター読み込み中...")
for row in ws_intro.iter_rows(min_row=2, max_row=ws_intro.max_row, values_only=True):
    code = row[0]
    if not code or code == 'イントロデューサーコード':
        continue
    intro_master[code] = {
        'グループ':  row[2] if row[2] else '',
        '小グループ': row[3] if row[3] else '',
        'グループ名': row[5] if row[5] else '',
        '状態':      row[7] if row[7] else '',
        '名前':      row[1] if row[1] else '',
    }

print(f"  イントロデューサーマスター: {len(intro_master)}件")

# ─── 特別イントロデューサー識別 ───
MIYAKE_CODE     = 580091   # 三宅 (Miyake, Ryuji) → BANK / プロスペリティ
FINTEREST_CODE  = 570234   # フィンタレスト (Finterest Co., Ltd.)
GRANDIR_GNAME   = 'グランディル'
INUI_GROUP      = '22.乾さんG'
INUI_GNAME      = '乾さん辻本さん'
SAKAI_DATE      = date(2023, 4, 12)   # 道下・酒井傘下 切替日
BANK_FULL_PRODS = {'PLATS', 'PLATPL', 'ACS', 'PLATS-CR'}  # Bank全額対象商品

# ─── 分配ルール関数 ───
def calc_split(intro_code, prod_code, group, small_g, gname, inception_date, comm_amount):
    """
    戻り値: (イントロ分, Goo分, マネージャーFee分, 特別対応フラグ)
    """
    if comm_amount is None or comm_amount == 0:
        return (0, 0, 0, '')

    c = float(comm_amount)

    # 1) 三宅さん (Miyake, Ryuji) 特別対応
    if intro_code == MIYAKE_CODE:
        return (round(c * 0.5, 2), round(c * 0.25, 2), round(c * 0.25, 2), '★三宅・道下')

    # 2) グランディル (10.竹田G with グランディルG名)
    if GRANDIR_GNAME in str(gname):
        return (round(c * 0.75, 2), round(c * 0.25, 2), 0, '★グランディル')

    # 3) 乾さん・辻本さん
    if group == INUI_GROUP or INUI_GNAME in str(gname):
        return (round(c * 0.75, 2), round(c * 0.25, 2), 0, '★乾辻本')

    # 4) 道下グループ (1.道下G)
    if group == '1.道下G':
        # 道下・酒井傘下で2023/4/12以前の成立は折半の可能性あり → 道下Gルールをデフォルト適用、フラグで要確認
        if inception_date and inception_date <= SAKAI_DATE:
            return (round(c * 0.5, 2), round(c * 0.25, 2), round(c * 0.25, 2), '要確認(酒井傘下確認)')
        return (round(c * 0.5, 2), round(c * 0.25, 2), round(c * 0.25, 2), '★道下G')

    # 5) 脇坂グループ (12.脇坂G)
    if group == '12.脇坂G':
        return (round(c * 0.5, 2), round(c * 0.25, 2), round(c * 0.25, 2), '★脇坂G')

    # 6) March G (4.March G)
    if group == '4.March G':
        return (round(c * 0.5, 2), round(c * 0.25, 2), round(c * 0.25, 2), '★March')

    # 7) BANKグループ
    if group == '1.BANK':
        # フィンタレスト: PLATS/PLATPL/ACS → 折半
        if intro_code == FINTEREST_CODE and prod_code in BANK_FULL_PRODS:
            return (round(c * 0.5, 2), round(c * 0.5, 2), 0, '★フィンタレスト')
        # BANK: PLATS/PLATPL/ACS → 全額イントロ
        if prod_code in BANK_FULL_PRODS:
            return (round(c * 1.0, 2), 0, 0, '★BANK全額')
        # BANK その他 → 折半
        return (round(c * 0.5, 2), round(c * 0.5, 2), 0, '')

    # 8) 通常 (折半)
    return (round(c * 0.5, 2), round(c * 0.5, 2), 0, '')

# ─── 出力Excel作成 ───
print("\nベースデータ作成中...")
wb_out = openpyxl.Workbook()
ws_out = wb_out.active
ws_out.title = 'ベースデータ'

# ヘッダー
HEADERS = [
    'アクティビティ日', '取引種類', 'ライティングイントロデューサー',
    'プラン番号',
    '氏名', 'イントロデューサーコード', 'イントロデューサー氏名', 'シーケンス',
    '説明', '商品コード', '期間', '通貨',
    '拠出金額', 'コミッション額(率)', 'スプリット率', 'コミッション額(USD)',
    '特別対応', '共同募集',
    'イントロデューサー分', 'Goo分', 'マネージャーFee分',
    'グループ', 'ステイタス',
    '照合ステータス'
]

# スタイル定義
header_fill = PatternFill(start_color='1F497D', end_color='1F497D', fill_type='solid')
header_font = Font(bold=True, color='FFFFFF', size=10)
new_col_fill = PatternFill(start_color='E2EFDA', end_color='E2EFDA', fill_type='solid')  # 追加列(緑系)
calc_col_fill = PatternFill(start_color='FFF2CC', end_color='FFF2CC', fill_type='solid')  # 計算列(黄系)
unmatch_fill = PatternFill(start_color='FFE0E0', end_color='FFE0E0', fill_type='solid')  # 不一致(赤系)
special_fill = PatternFill(start_color='FCE4D6', end_color='FCE4D6', fill_type='solid')   # 特別対応(オレンジ系)
thin_border = Border(
    left=Side(style='thin'), right=Side(style='thin'),
    top=Side(style='thin'), bottom=Side(style='thin')
)

# ヘッダー行
for col_idx, h in enumerate(HEADERS, 1):
    cell = ws_out.cell(row=1, column=col_idx, value=h)
    cell.fill = header_fill
    cell.font = header_font
    cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)

# 新規追加列インデックス (1-based)
NEW_COLS = {5, 6, 7, 8, 17, 18, 19, 20, 21, 22, 23, 24}

# ヘッダーに背景色
for col_idx in range(1, len(HEADERS)+1):
    cell = ws_out.cell(row=1, column=col_idx)
    if col_idx in NEW_COLS:
        cell.fill = PatternFill(start_color='305496', end_color='305496', fill_type='solid')
        cell.font = Font(bold=True, color='FFFFFF', size=10)

# カウンター
stats = {'total': 0, 'matched': 0, 'unmatched': 0, 'special': 0, 'check_needed': 0}
period_stats = defaultdict(lambda: {'rows': 0, 'intro': 0.0, 'goo': 0.0, 'mgr': 0.0, 'comm': 0.0})

# データ書き込み
out_row = 2
for row in ws_goo.iter_rows(min_row=3, max_row=ws_goo.max_row, values_only=True):
    act_date    = row[0]   # アクティビティ日
    trade_type  = row[1]   # 取引種類
    writing_int = row[2]   # ライティングイントロデューサー
    plan_no     = row[3]   # プラン番号
    desc        = row[4]   # 説明
    prod_code   = row[5]   # 商品コード
    period      = row[6]   # 期間
    currency    = row[7]   # 通貨
    contrib     = row[8]   # 拠出金額
    comm_rate   = row[9]   # コミッション額(率)
    split_rate  = row[10]  # スプリット率
    comm_amt    = row[11]  # コミッション額(USD)

    if not plan_no or plan_no == 'プラン番号':
        continue
    if not isinstance(comm_amt, (int, float)):
        continue
    stats['total'] += 1

    # 期間ラベル
    period_label = str(desc).split('for ')[-1] if desc and 'for ' in str(desc) else '不明'

    # 顧客マスター照合
    key = (plan_no, prod_code if prod_code else '')
    master_data = cust_by_plan_prod.get(key)

    if master_data:
        seq, cust_name, intro_code, intro_name, cust_status, inc_date = master_data
        match_status = '照合済'
        stats['matched'] += 1
    else:
        # プランのみで代替照合
        plan_rows = cust_by_plan.get(plan_no, [])
        if plan_rows:
            # 最初のエントリを使用
            first = plan_rows[0]
            seq, intro_code, intro_name, cust_status, inc_date = first[0], first[3], first[4], first[5], first[6]
            cust_name = first[2]
            match_status = '商品コード不一致(要確認)'
            stats['unmatched'] += 1
        else:
            seq = cust_name = intro_code = intro_name = cust_status = inc_date = ''
            match_status = 'マスター未照合'
            stats['unmatched'] += 1

    # イントロデューサーマスター照合
    intro_info = intro_master.get(intro_code, {}) if intro_code else {}
    group    = intro_info.get('グループ', '')
    small_g  = intro_info.get('小グループ', '')
    gname    = intro_info.get('グループ名', '')
    i_status = intro_info.get('状態', '')

    # 分配計算
    intro_share, goo_share, mgr_share, special_flag = calc_split(
        intro_code, prod_code, group, small_g, gname, inc_date, comm_amt
    )

    if special_flag:
        stats['special'] += 1
    if '要確認' in match_status or '要確認' in special_flag:
        stats['check_needed'] += 1

    # 期間別集計
    period_stats[period_label]['rows'] += 1
    period_stats[period_label]['intro'] += intro_share
    period_stats[period_label]['goo'] += goo_share
    period_stats[period_label]['mgr'] += mgr_share
    if comm_amt:
        period_stats[period_label]['comm'] += float(comm_amt)

    # 行書き込み
    row_data = [
        act_date, trade_type, writing_int,
        plan_no,
        cust_name, intro_code, intro_name, seq,
        desc, prod_code, period, currency,
        contrib, comm_rate, split_rate, comm_amt,
        special_flag, '',  # 共同募集は空欄
        intro_share if intro_share != 0 else None,
        goo_share if goo_share != 0 else None,
        mgr_share if mgr_share != 0 else None,
        group, i_status,
        match_status
    ]

    # 行の背景色判定
    row_fill = None
    if '未照合' in match_status:
        row_fill = unmatch_fill
    elif '要確認' in special_flag or '要確認' in match_status:
        row_fill = special_fill

    for col_idx, val in enumerate(row_data, 1):
        cell = ws_out.cell(row=out_row, column=col_idx, value=val)
        if isinstance(val, datetime):
            cell.number_format = 'YYYY/MM/DD'
        if row_fill:
            cell.fill = row_fill
        elif col_idx in {5, 6, 7, 8}:
            cell.fill = new_col_fill
        elif col_idx in {19, 20, 21}:
            cell.fill = calc_col_fill

    out_row += 1

print(f"  書き込み完了: {out_row - 2}行")

# ─── 列幅調整 ───
col_widths = {
    1: 14, 2: 14, 3: 38, 4: 16,
    5: 22, 6: 18, 7: 28, 8: 14,
    9: 32, 10: 12, 11: 8, 12: 8,
    13: 14, 14: 14, 15: 10, 16: 16,
    17: 22, 18: 12,
    19: 16, 20: 14, 21: 18,
    22: 20, 23: 14, 24: 20
}
for col, w in col_widths.items():
    ws_out.column_dimensions[get_column_letter(col)].width = w

ws_out.row_dimensions[1].height = 30
ws_out.freeze_panes = 'A2'

# ─── サマリーシート ───
ws_sum = wb_out.create_sheet('集計サマリー')
ws_sum['A1'] = 'Goo社 運用委託費 ベースデータ 集計サマリー'
ws_sum['A1'].font = Font(bold=True, size=14)

ws_sum['A3'] = '【照合状況】'
ws_sum['A3'].font = Font(bold=True)
ws_sum['A4']  = '総データ行数'
ws_sum['B4']  = stats['total']
ws_sum['A5']  = '照合済'
ws_sum['B5']  = stats['matched']
ws_sum['A6']  = '不一致/未照合'
ws_sum['B6']  = stats['unmatched']
ws_sum['A7']  = '特別対応フラグあり'
ws_sum['B7']  = stats['special']
ws_sum['A8']  = '要確認フラグあり'
ws_sum['B8']  = stats['check_needed']

ws_sum['A10'] = '【期間別集計 (USD)】'
ws_sum['A10'].font = Font(bold=True)
headers_s = ['期間', '行数', 'コミッション合計', 'イントロ分合計', 'Goo分合計', 'マネージャーFee合計']
for ci, h in enumerate(headers_s, 1):
    ws_sum.cell(row=11, column=ci, value=h).font = Font(bold=True)

s_row = 12
total_row = {'rows': 0, 'comm': 0.0, 'intro': 0.0, 'goo': 0.0, 'mgr': 0.0}
for period_label in sorted(period_stats.keys()):
    d = period_stats[period_label]
    ws_sum.cell(row=s_row, column=1, value=period_label)
    ws_sum.cell(row=s_row, column=2, value=d['rows'])
    ws_sum.cell(row=s_row, column=3, value=round(d['comm'], 2)).number_format = '#,##0.00'
    ws_sum.cell(row=s_row, column=4, value=round(d['intro'], 2)).number_format = '#,##0.00'
    ws_sum.cell(row=s_row, column=5, value=round(d['goo'], 2)).number_format = '#,##0.00'
    ws_sum.cell(row=s_row, column=6, value=round(d['mgr'], 2)).number_format = '#,##0.00'
    for k, v in [('rows', d['rows']), ('comm', d['comm']), ('intro', d['intro']), ('goo', d['goo']), ('mgr', d['mgr'])]:
        total_row[k] += v if isinstance(v, (int, float)) else 0
    s_row += 1

# 合計行
ws_sum.cell(row=s_row, column=1, value='合計').font = Font(bold=True)
ws_sum.cell(row=s_row, column=2, value=total_row['rows']).font = Font(bold=True)
ws_sum.cell(row=s_row, column=3, value=round(total_row['comm'], 2)).number_format = '#,##0.00'
ws_sum.cell(row=s_row, column=4, value=round(total_row['intro'], 2)).number_format = '#,##0.00'
ws_sum.cell(row=s_row, column=5, value=round(total_row['goo'], 2)).number_format = '#,##0.00'
ws_sum.cell(row=s_row, column=6, value=round(total_row['mgr'], 2)).number_format = '#,##0.00'

s_row += 2
ws_sum['A' + str(s_row)] = '【特別対応ルール適用内訳 (USD)】'
ws_sum['A' + str(s_row)].font = Font(bold=True)
s_row += 1

# 特別対応フラグごとの集計
flag_stats = defaultdict(lambda: {'rows': 0, 'intro': 0.0, 'goo': 0.0, 'mgr': 0.0, 'comm': 0.0})
for data_row in ws_out.iter_rows(min_row=2, max_row=ws_out.max_row, values_only=True):
    flag = data_row[16] if data_row[16] else '通常(折半)'
    flag_stats[flag]['rows'] += 1
    for ci, key in [(18, 'intro'), (19, 'goo'), (20, 'mgr'), (15, 'comm')]:
        v = data_row[ci]
        if v and isinstance(v, (int, float)):
            flag_stats[flag][key] += v

headers_f = ['フラグ', '行数', 'コミッション合計', 'イントロ分', 'Goo分', 'マネージャーFee']
for ci, h in enumerate(headers_f, 1):
    ws_sum.cell(row=s_row, column=ci, value=h).font = Font(bold=True)
s_row += 1
for flag, d in sorted(flag_stats.items()):
    ws_sum.cell(row=s_row, column=1, value=flag)
    ws_sum.cell(row=s_row, column=2, value=d['rows'])
    ws_sum.cell(row=s_row, column=3, value=round(d['comm'], 2)).number_format = '#,##0.00'
    ws_sum.cell(row=s_row, column=4, value=round(d['intro'], 2)).number_format = '#,##0.00'
    ws_sum.cell(row=s_row, column=5, value=round(d['goo'], 2)).number_format = '#,##0.00'
    ws_sum.cell(row=s_row, column=6, value=round(d['mgr'], 2)).number_format = '#,##0.00'
    s_row += 1

s_row += 1
ws_sum['A' + str(s_row)] = '【注意事項・要確認事項】'
ws_sum['A' + str(s_row)].font = Font(bold=True, color='FF0000')
notes = [
    '1. 照合ステータス「マスター未照合」行 → 顧客マスターにプラン番号なし。解除済ポリシーの可能性。手動で氏名・イントロ情報を補完。',
    '2. 照合ステータス「商品コード不一致(要確認)」行 → プランは存在するが商品コードが異なる。別ライダー等の可能性。',
    '3. 特別対応「要確認(酒井傘下確認)」行 → 道下G且つ発効日2023/4/12以前。酒井傘下の場合は折半適用済み、道下直接の場合は道下Gルール(50/25/25)に変更。',
    '4. 三宅さん(Miyake, Ryuji / 580091) → 特別対応「★三宅・道下」として50%/25%/25%適用。',
    '5. 共同募集 → 「共同募集」列に印をつけ、行を追加・分割する作業は手動で実施。',
    '6. 道下Gは全員「移籍」ステータスのため、現在の担当先を確認のうえ報告先を決定。',
    '7. イントロ分・Goo分・マネージャーFee分の合計がコミッション額(USD)と一致することを確認。',
]
for note in notes:
    s_row += 1
    ws_sum['A' + str(s_row)] = note
    ws_sum.column_dimensions['A'].width = 120

wb_out.save(OUT_FILE)
print(f"\n✓ 出力完了: {OUT_FILE}")
print(f"\n=== 処理結果サマリー ===")
print(f"  総データ行数:       {stats['total']:,}行")
print(f"  照合済:             {stats['matched']:,}行")
print(f"  不一致/未照合:      {stats['unmatched']:,}行")
print(f"  特別対応フラグあり: {stats['special']:,}行")
print(f"  要確認フラグあり:   {stats['check_needed']:,}行")
print()
print("期間別集計 (USD):")
grand_comm = grand_intro = grand_goo = grand_mgr = 0
for period_label in sorted(period_stats.keys()):
    d = period_stats[period_label]
    print(f"  {period_label}: {d['rows']:4}行  コミッション:{d['comm']:10,.2f}  イントロ:{d['intro']:9,.2f}  Goo:{d['goo']:9,.2f}  MGR:{d['mgr']:8,.2f}")
    grand_comm += d['comm']; grand_intro += d['intro']; grand_goo += d['goo']; grand_mgr += d['mgr']
print(f"  合計:      {stats['total']:4}行  コミッション:{grand_comm:10,.2f}  イントロ:{grand_intro:9,.2f}  Goo:{grand_goo:9,.2f}  MGR:{grand_mgr:8,.2f}")
