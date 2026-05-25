from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.page import PageMargins

wb = Workbook()
ws = wb.active
ws.title = "請求書"

# ── 列幅
# A(margin) B(key) C(content-main) D(content-sub) E(qty) F(unit) G(tax) H(amount) I(margin)
for col, w in {"A":2,"B":12,"C":26,"D":10,"E":7,"F":7,"G":10,"H":15,"I":2}.items():
    ws.column_dimensions[col].width = w

# ── 行高
heights = {
    1:6,  2:20, 3:30, 4:18, 5:18, 6:18, 7:5,
    8:8,  9:18, 10:22,11:10,12:16,13:6, 14:26,
    15:6, 16:18,17:6, 18:18,19:18,20:18,21:6,
    22:16,23:18,24:18,25:18,26:18,27:18,28:6, 29:14,
}
for r, h in heights.items():
    ws.row_dimensions[r].height = h

# ── カラー
DARK   = "0A0818"
DARK2  = "1A1245"
PURPLE = "764BA2"
ACCENT = "667EEA"
ACC2   = "A5B4FC"
LIGHT  = "F5F2FC"
LIGHT2 = "FAF8FF"
WHITE  = "FFFFFF"
GRAY   = "999999"
GRAY2  = "CCCCCC"
TEXT   = "1A1A2E"
BORDER = "E2D9F3"

def fill(c):  return PatternFill("solid", fgColor=c)
def s(style="thin", color=BORDER): return Side(style=style, color=color)
def ns():  return Side(style=None)
def brd(t=False,b=False,l=False,r=False,c=BORDER,style="thin"):
    ss = s(style,c)
    return Border(top=ss if t else ns(), bottom=ss if b else ns(),
                  left=ss if l else ns(), right=ss if r else ns())

def cell(row, col, val="", bold=False, sz=10, color=TEXT,
         bg=None, ha="left", va="center", wrap=False, border=None, fmt=None, italic=False):
    c = ws.cell(row=row, column=col, value=val)
    c.font = Font(name="游ゴシック", bold=bold, size=sz, color=color, italic=italic)
    c.alignment = Alignment(horizontal=ha, vertical=va, wrap_text=wrap)
    if bg:     c.fill = fill(bg)
    if border: c.border = border
    if fmt:    c.number_format = fmt
    return c

def mg(r1,c1,r2,c2):
    ws.merge_cells(start_row=r1,start_column=c1,end_row=r2,end_column=c2)

A,B,C,D,E,F,G,H,I = 1,2,3,4,5,6,7,8,9

# ════════════════════════════════════════
# ヘッダー背景 rows 1-6 (全列ダーク)
# ════════════════════════════════════════
for r in range(1, 7):
    for c in range(1, 10):
        ws.cell(row=r, column=c).fill = fill(DARK)

# アクセントライン row 7
ws.row_dimensions[7].height = 4
for c in range(1, 10):
    ws.cell(row=7, column=c).fill = fill(PURPLE)

# ── 左ブロック：タイトル／No.／Date ─────
# "INVOICE" サブラベル
mg(2,B, 2,D)
cell(2,B, "INVOICE", sz=8, color=ACC2, bg=DARK, ha="left", va="center", bold=True)

# "請 求 書"
mg(3,B, 3,D)
cell(3,B, "請 求 書", bold=True, sz=20, color=WHITE, bg=DARK, va="center")

# No.
cell(4,B, "No.", sz=8, color=ACC2, bg=DARK, va="center", bold=True)
mg(4,C, 4,D)
cell(4,C, "INV-20260525-001", sz=10, color=WHITE, bg=DARK, va="center", bold=True)

# Date
cell(5,B, "Date", sz=8, color=ACC2, bg=DARK, va="center", bold=True)
mg(5,C, 5,D)
cell(5,C, "2026年5月25日", sz=10, color=WHITE, bg=DARK, va="center")

# ── 右ブロック：発行者（右端、F〜H列） ──
# 右ブロック背景を少し明るく
for r in range(1, 7):
    for c in [F, G, H]:
        ws.cell(row=r, column=c).fill = fill("0F0C30")

# "ISSUED BY" ラベル
mg(2,F, 2,H)
cell(2,F, "ISSUED BY", sz=7, color=ACC2, bg="0F0C30", ha="right", va="center", bold=True)

# 氏名
mg(3,F, 3,H)
cell(3,F, "可知 優也", bold=True, sz=14, color=WHITE, bg="0F0C30", ha="right", va="center")

# 住所1
mg(4,F, 4,H)
cell(4,F, "愛知県名古屋市昭和区壇溪通1丁目7番地", sz=8, color=GRAY2, bg="0F0C30", ha="right", va="center")

# 住所2
mg(5,F, 5,H)
cell(5,F, "アンシェリーナ106", sz=8, color=GRAY2, bg="0F0C30", ha="right", va="center")

# TEL
mg(6,F, 6,H)
cell(6,F, "TEL: 080-6925-9411", sz=8, color=GRAY2, bg="0F0C30", ha="right", va="center")

# 免税バッジ row (アクセントライン行に重ねる)
# → 別途 row 6 下に免税テキストを置く
# 免税事業者はrow 6に追加
# row 6 左側 (B-D) に空きがあるので免税をそこに
mg(6,B, 6,D)
cell(6,B, "免税事業者 · 登録番号なし", sz=7, color="555577", bg=DARK, ha="left", va="center")

# ════════════════════════════════════════
# 宛先 rows 8-11
# ════════════════════════════════════════
mg(8,B, 8,H)
cell(8,B, "BILL TO  /  請求先", sz=7, color=PURPLE, ha="left", va="center", bold=True)

mg(9,B, 9,E)
c10 = cell(9,B, "合同会社 Frigus　御中", bold=True, sz=16, color=TEXT, va="bottom")
c10.border = Border(bottom=Side(style="medium", color=DARK2))

mg(10,B, 10,H)
cell(10,B, "", bg=WHITE)

# ════════════════════════════════════════
# 請求金額 row 12
# ════════════════════════════════════════
ws.row_dimensions[12].height = 34
for c in range(1, 10):
    ws.cell(row=12, column=c).fill = fill(DARK2)
mg(12,B, 12,E)
cell(12,B, "ご請求金額（税込）", sz=9, color="8899CC", bg=DARK2, va="center")
mg(12,F, 12,H)
cell(12,F, 202306, bold=True, sz=18, color=WHITE, bg=DARK2, ha="right", va="center", fmt="¥#,##0")

# ════════════════════════════════════════
# 明細ヘッダー row 14
# ════════════════════════════════════════
hb = brd(t=True,b=True,l=True,r=True)
cell(14,B, "日付",   bold=True, sz=8, color=PURPLE, bg=LIGHT, ha="center", border=hb)
mg(14,C, 14,D)
cell(14,C, "内容",   bold=True, sz=8, color=PURPLE, bg=LIGHT, border=hb)
cell(14,E, "数量",   bold=True, sz=8, color=PURPLE, bg=LIGHT, ha="center", border=hb)
cell(14,F, "単位",   bold=True, sz=8, color=PURPLE, bg=LIGHT, ha="center", border=hb)
cell(14,G, "税区分", bold=True, sz=8, color=PURPLE, bg=LIGHT, ha="center", border=hb)
cell(14,H, "金額",   bold=True, sz=8, color=PURPLE, bg=LIGHT, ha="right",  border=hb)

# ════════════════════════════════════════
# 明細データ row 16 (内容セルは wrap)
# ════════════════════════════════════════
ws.row_dimensions[16].height = 26
db = brd(t=True,b=True,l=True,r=True)
cell(16,B, "2026年5月25日", sz=9, color=GRAY, ha="center", border=db)
mg(16,C, 16,D)
cell(16,C, "Goo Property Singapore Pte. Ltd.社からの保全費（2026年2月預かり金より）",
     sz=9, color=TEXT, wrap=True, border=db)
cell(16,E, 1,        sz=9, color=TEXT, ha="center", border=db)
cell(16,F, "式",     sz=9, color=TEXT, ha="center", border=db)
cell(16,G, "対象外", sz=9, color=PURPLE, ha="center", bg="EDE9FB", border=db)
cell(16,H, 202306,   sz=9, color=TEXT, ha="right",  border=db, fmt="¥#,##0")

# ════════════════════════════════════════
# 合計 rows 18-20
# ════════════════════════════════════════
for row, label, val, total in [
    (18, "小計",   "¥202,306", False),
    (19, "消費税", "¥0（対象外）", False),
    (20, "合　計", 202306,    True),
]:
    mg(row, F, row, G)
    cell(row, F, label,
         bold=total, sz=9 if not total else 11,
         color=WHITE if total else GRAY,
         bg=DARK2 if total else WHITE, ha="right",
         border=brd(t=True,b=True,l=True,r=True,
                    c=BORDER if not total else DARK2))
    c = ws.cell(row=row, column=H,
                value=val if not total else 202306)
    c.font = Font(name="游ゴシック", bold=total,
                  size=11 if total else 9,
                  color=WHITE if total else GRAY)
    c.alignment = Alignment(horizontal="right", vertical="center")
    c.fill = fill(DARK2) if total else fill(WHITE)
    if total: c.number_format = "¥#,##0"
    c.border = brd(t=True,b=True,l=True,r=True,
                   c=BORDER if not total else DARK2)

# ════════════════════════════════════════
# 振込先 rows 22-27
# ════════════════════════════════════════
mg(22,B, 22,H)
cell(22,B, "BANK TRANSFER  /  お振込先", sz=7, color=PURPLE, bold=True)

bk = brd(t=True,b=True,l=True,r=True)
for row, key, val in [
    (23, "銀行名",   "楽天銀行"),
    (24, "支店名",   "ボレロ支店"),
    (25, "口座種別", "普通預金"),
    (26, "口座番号", "4541728"),
    (27, "口座名義", "カチユウヤ"),
]:
    cell(row, B, key, bold=True, sz=8, color=GRAY, bg=LIGHT, border=bk)
    mg(row, C, row, H)
    cell(row, C, val, sz=10, color=DARK2, bg=LIGHT2, border=bk)

# ════════════════════════════════════════
# フッター row 29
# ════════════════════════════════════════
mg(29,B, 29,H)
cell(29,B, "ご不明な点はお気軽にご連絡ください。  TEL: 080-6925-9411",
     sz=8, color=GRAY2, italic=True)

# ════════════════════════════════════════
# 印刷設定
# ════════════════════════════════════════
ws.page_setup.orientation = "portrait"
ws.page_setup.paperSize   = 9
ws.page_margins = PageMargins(left=0.5, right=0.5, top=0.6, bottom=0.6)
ws.print_area = "A1:I30"

wb.save("/home/user/test/請求書_INV-20260525-001.xlsx")
print("Done")
