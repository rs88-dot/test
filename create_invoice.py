from openpyxl import Workbook
from openpyxl.styles import (
    Font, PatternFill, Alignment, Border, Side, GradientFill
)
from openpyxl.utils import get_column_letter

wb = Workbook()
ws = wb.active
ws.title = "請求書"

# ── 列幅 ──
col_widths = {
    "A": 3, "B": 18, "C": 38, "D": 8, "E": 8, "F": 10, "G": 16, "H": 3
}
for col, w in col_widths.items():
    ws.column_dimensions[col].width = w

# ── 行高 ──
row_heights = {
    1: 8, 2: 36, 3: 14, 4: 22, 5: 22, 6: 10, 7: 22, 8: 22, 9: 22, 10: 10,
    11: 28, 12: 10, 13: 22, 14: 22, 15: 14, 16: 22, 17: 22, 18: 22, 19: 14,
    20: 22, 21: 22, 22: 14, 23: 22, 24: 14, 25: 22, 26: 14, 27: 22, 28: 14,
}
for r, h in row_heights.items():
    ws.row_dimensions[r].height = h

# ── ヘルパー ──
DARK   = "1A1A3E"
PURPLE = "764BA2"
ACCENT = "667EEA"
LIGHT  = "F3F0FB"
WHITE  = "FFFFFF"
GRAY   = "888888"
TEXT   = "1A1A2E"
BORDER_COLOR = "D0C8F0"

def dark_fill():  return PatternFill("solid", fgColor=DARK)
def purple_fill(): return PatternFill("solid", fgColor=PURPLE)
def light_fill():  return PatternFill("solid", fgColor=LIGHT)
def white_fill():  return PatternFill("solid", fgColor=WHITE)
def accent_fill(): return PatternFill("solid", fgColor="EDE9FB")

def thin_border(top=False, bottom=False, left=False, right=False):
    s = Side(style="thin", color=BORDER_COLOR)
    n = Side(style=None)
    return Border(
        top=s if top else n,
        bottom=s if bottom else n,
        left=s if left else n,
        right=s if right else n,
    )

def thick_bottom():
    return Border(bottom=Side(style="medium", color=PURPLE))

def set_cell(ws, row, col, value, bold=False, size=11, color=TEXT,
             fill=None, align_h="left", align_v="center",
             wrap=False, border=None, number_format=None, italic=False):
    c = ws.cell(row=row, column=col, value=value)
    c.font = Font(name="游ゴシック", bold=bold, size=size, color=color, italic=italic)
    c.alignment = Alignment(horizontal=align_h, vertical=align_v,
                            wrap_text=wrap)
    if fill:   c.fill = fill
    if border: c.border = border
    if number_format: c.number_format = number_format
    return c

def merge(ws, r1, c1, r2, c2):
    ws.merge_cells(start_row=r1, start_column=c1, end_row=r2, end_column=c2)

# ════════════════════════════════════════════
# ROW 2  ヘッダー背景
# ════════════════════════════════════════════
for col in range(1, 9):
    ws.cell(row=2, column=col).fill = dark_fill()

merge(ws, 2, 2, 2, 4)
set_cell(ws, 2, 2, "請 求 書", bold=True, size=20, color=WHITE,
         fill=dark_fill(), align_v="center")

merge(ws, 2, 5, 2, 7)
set_cell(ws, 2, 5, "Invoice", bold=False, size=11, color="AAAACC",
         fill=dark_fill(), align_h="right", align_v="center", italic=True)

# ROW 3  アクセントライン
for col in range(1, 9):
    c = ws.cell(row=3, column=col)
    c.fill = purple_fill()
    c.row_dimensions if False else None
ws.row_dimensions[3].height = 5

# ════════════════════════════════════════════
# ROW 4-5  請求書番号 / 発行日
# ════════════════════════════════════════════
merge(ws, 4, 2, 4, 4)
set_cell(ws, 4, 2, "請求書番号", bold=True, size=9, color=GRAY)
merge(ws, 4, 5, 4, 7)
set_cell(ws, 4, 5, "INV-20260525-001", bold=True, size=11, color=PURPLE,
         align_h="right")

merge(ws, 5, 2, 5, 4)
set_cell(ws, 5, 2, "発行日", bold=True, size=9, color=GRAY)
merge(ws, 5, 5, 5, 7)
set_cell(ws, 5, 5, "2026年5月25日", bold=False, size=11, color=TEXT,
         align_h="right")

# ════════════════════════════════════════════
# ROW 7-9  宛先
# ════════════════════════════════════════════
merge(ws, 7, 2, 7, 7)
set_cell(ws, 7, 2, "■ 請求先", bold=True, size=9, color=PURPLE)

merge(ws, 8, 2, 8, 5)
set_cell(ws, 8, 2, "合同会社 Frigus　御中", bold=True, size=16, color=TEXT,
         border=thick_bottom())

merge(ws, 9, 2, 9, 5)
set_cell(ws, 9, 2, "", size=9)

# ════════════════════════════════════════════
# ROW 11  請求金額ハイライト
# ════════════════════════════════════════════
ws.row_dimensions[11].height = 38
for col in range(2, 8):
    ws.cell(row=11, column=col).fill = dark_fill()

merge(ws, 11, 2, 11, 4)
set_cell(ws, 11, 2, "ご請求金額（税込）", bold=False, size=10,
         color="AAAACC", fill=dark_fill(), align_v="center")

merge(ws, 11, 5, 11, 7)
set_cell(ws, 11, 5, 202306, bold=True, size=22, color=WHITE,
         fill=dark_fill(), align_h="right", align_v="center",
         number_format='¥#,##0')

# ════════════════════════════════════════════
# ROW 13  明細ヘッダー
# ════════════════════════════════════════════
headers = ["日付", "内容", "", "数量", "単位", "税区分", "金額"]
cols    = [2,       3,     4,   5,      6,      7,         None]
# 内容は B-D をマージ
merge(ws, 13, 3, 13, 4)

hdr_data = [
    (2, "日付"),
    (3, "内容"),
    (5, "数量"),
    (6, "単位"),
    (7, "税区分"),
]
for col, label in [(2,"日付"),(5,"数量"),(6,"単位"),(7,"税区分")]:
    set_cell(ws, 13, col, label, bold=True, size=9, color=PURPLE,
             fill=light_fill(), align_h="center",
             border=thin_border(top=True, bottom=True, left=True, right=True))

# 内容マージ
merge(ws, 13, 3, 13, 4)
set_cell(ws, 13, 3, "内容", bold=True, size=9, color=PURPLE,
         fill=light_fill(),
         border=thin_border(top=True, bottom=True, left=True, right=True))

# G列（金額）は右揃え
set_cell(ws, 13, 7, "金額", bold=True, size=9, color=PURPLE,
         fill=light_fill(), align_h="right",
         border=thin_border(top=True, bottom=True, left=True, right=True))

# ════════════════════════════════════════════
# ROW 14  明細データ
# ════════════════════════════════════════════
ws.row_dimensions[14].height = 28
set_cell(ws, 14, 2, "2026年5月25日", size=10, color=GRAY, align_h="center",
         border=thin_border(top=True, bottom=True, left=True, right=True))

merge(ws, 14, 3, 14, 4)
set_cell(ws, 14, 3, "Goo Property Singapore Pte. Ltd.社からの保全費（2026年2月預かり金より）",
         size=10, color=TEXT, wrap=True,
         border=thin_border(top=True, bottom=True, left=True, right=True))

set_cell(ws, 14, 5, 1, size=10, color=TEXT, align_h="center",
         border=thin_border(top=True, bottom=True, left=True, right=True))
set_cell(ws, 14, 6, "式", size=10, color=TEXT, align_h="center",
         border=thin_border(top=True, bottom=True, left=True, right=True))
set_cell(ws, 14, 7, "対象外", size=10, color=PURPLE, align_h="center",
         fill=accent_fill(),
         border=thin_border(top=True, bottom=True, left=True, right=True))

# ════════════════════════════════════════════
# ROW 16-18  合計
# ════════════════════════════════════════════
for row, label, val, is_total in [
    (16, "小計",   202306, False),
    (17, "消費税", 0,      False),
    (18, "合計",   202306, True),
]:
    merge(ws, row, 5, row, 6)
    set_cell(ws, row, 5, label,
             bold=is_total, size=10 if not is_total else 12,
             color=DARK if is_total else TEXT,
             align_h="right",
             fill=dark_fill() if is_total else white_fill(),
             border=thin_border(top=True, bottom=True, left=True, right=True))
    c = ws.cell(row=row, column=7, value=val)
    c.font = Font(name="游ゴシック", bold=is_total,
                  size=10 if not is_total else 14,
                  color=WHITE if is_total else TEXT)
    c.alignment = Alignment(horizontal="right", vertical="center")
    c.number_format = '¥#,##0'
    c.fill = dark_fill() if is_total else white_fill()
    c.border = thin_border(top=True, bottom=True, left=True, right=True)
    if row == 17:
        ws.cell(row=row, column=7).value = 0
        ws.cell(row=row, column=7).number_format = '¥#,##0'

# 消費税の補足
set_cell(ws, 17, 7, "¥0（対象外）", size=10, color=GRAY,
         align_h="right",
         border=thin_border(top=True, bottom=True, left=True, right=True))

# ════════════════════════════════════════════
# ROW 20-25  振込先
# ════════════════════════════════════════════
merge(ws, 20, 2, 20, 7)
set_cell(ws, 20, 2, "■ お振込先", bold=True, size=9, color=PURPLE)

bank_info = [
    (21, "銀行名",   "楽天銀行"),
    (22, "支店名",   "ボレロ支店"),
    (23, "口座種別", "普通預金"),
    (24, "口座番号", "4541728"),
    (25, "口座名義", "カチユウヤ"),
]
for row, key, val in bank_info:
    set_cell(ws, row, 2, key, bold=True, size=9, color=GRAY,
             fill=light_fill(),
             border=thin_border(top=True, bottom=True, left=True, right=True))
    merge(ws, row, 3, row, 7)
    set_cell(ws, row, 3, val, size=11, color=DARK,
             fill=light_fill(),
             border=thin_border(top=True, bottom=True, left=True, right=True))

# ════════════════════════════════════════════
# ROW 27  発行者
# ════════════════════════════════════════════
merge(ws, 27, 2, 27, 7)
set_cell(ws, 27, 2, "■ 発行者", bold=True, size=9, color=PURPLE)

merge(ws, 28, 2, 28, 7)
set_cell(ws, 28, 2,
         "可知 優也　|　愛知県名古屋市昭和区壇溪通1丁目7番地 アンシェリーナ106　|　TEL: 080-6925-9411　|　免税事業者",
         size=9, color=GRAY)

# ════════════════════════════════════════════
# 印刷設定
# ════════════════════════════════════════════
from openpyxl.worksheet.page import PageMargins
ws.page_setup.orientation = "portrait"
ws.page_setup.paperSize   = 9   # A4
ws.page_margins = PageMargins(left=0.5, right=0.5, top=0.75, bottom=0.75)
ws.print_area = "A1:H30"

wb.save("/home/user/test/請求書_INV-20260525-001.xlsx")
print("Done")
