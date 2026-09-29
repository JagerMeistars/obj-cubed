"""Software diagnostic preview of geometry produced by the native BB audit.

No Blockbench, Minecraft, browser, profile or computer-control access. Colors
identify editable source geometry versus excluded reference guides; they are
not a screenshot or a texture/material renderer.
"""
import json
import math
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
INPUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "audit/template-native/template-proof/preview-geometry.json"
OUTPUT = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "dist/objcubed-template-preview.png"
MODELS = json.loads(INPUT.read_text(encoding="utf-8"))
TITLES = ["Конская броня", "Седло лошади", "Седло осла", "Седло мула", "Седло зомби-лошади", "Седло скелета-лошади", "Волчья броня", "Попона ламы", "Упряжь счастливого гаста", "Элитры", "Седло верблюда", "Седло верблюда-кадавра", "Седло свиньи", "Седло лавомерки", "Броня наутилуса", "Седло наутилуса"]
SCALE = 2
W, H = 1800, 1900
image = Image.new("RGB", (W*SCALE, H*SCALE), (19, 23, 30))
draw = ImageDraw.Draw(image)
def font(size, bold=False):
    return ImageFont.truetype(str(Path("C:/Windows/Fonts") / ("segoeuib.ttf" if bold else "segoeui.ttf")), size*SCALE)
def text(x, y, label, size, color, bold=False):
    draw.text((x*SCALE,y*SCALE),label,font=font(size,bold),fill=color)
def projection(p):
    x,y,z=p
    return ((x*.8-z*.6),(-y*.92-(x*.6+z*.8)*.39), (x*.6+z*.8)*.92-y*.39)
def polygon(points,fill,outline=None,width=1):
    draw.polygon([(round(x*SCALE),round(y*SCALE)) for x,y in points],fill=fill,outline=outline,width=width*SCALE)
text(34,24,"objcubed · шаблоны в собранной позе",38,(236,241,247),True)
text(36,80,"Цветные части — для моделирования. Серые — ориентиры, исключённые из экспорта.",22,(176,193,208))
text(36,116,"Геометрический CPU-превью по .bbmodel; не скриншот Blockbench или Minecraft.",18,(128,148,169))
palette=[(84,174,211),(229,164,76),(91,178,145),(180,136,206),(218,119,117),(101,161,203),(133,187,117),(173,179,188)]
for number, model in enumerate(MODELS):
    col,row=number%4,number//4
    left,top=25+col*441,171+row*426
    draw.rounded_rectangle((left*SCALE,top*SCALE,(left+423)*SCALE,(top+408)*SCALE),radius=16*SCALE,fill=(29,35,45),outline=(48,60,74),width=SCALE)
    quads=model["quads"]
    points=[projection(p) for quad in quads for p in quad["points"]]
    xmin,xmax=min(p[0] for p in points),max(p[0] for p in points)
    ymin,ymax=min(p[1] for p in points),max(p[1] for p in points)
    zoom=min(363/max(xmax-xmin,1e-4),292/max(ymax-ymin,1e-4))
    ox,oy=left+211.5-(xmin+xmax)*zoom/2,top+155-(ymin+ymax)*zoom/2
    def depth(q):return sum(projection(p)[2] for p in q["points"])/4
    for q in sorted(quads,key=depth,reverse=True):
        projected=[projection(p) for p in q["points"]]
        a,b,c=q["points"][:3]
        u=[b[i]-a[i] for i in range(3)];v=[c[i]-a[i] for i in range(3)]
        n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
        length=math.sqrt(sum(x*x for x in n)) or 1
        shade=.73+.27*abs((n[0]*.28+n[1]*.86-n[2]*.42)/length)
        rgb=(115,128,143) if q["guide"] else palette[q["color"]%len(palette)]
        polygon([(p[0]*zoom+ox,p[1]*zoom+oy) for p in projected],tuple(int(x*shade) for x in rgb),(43,53,66))
    text(left+18,top+330,TITLES[number],21,(230,236,244),True)
    text(left+18,top+367,model["target"],17,(143,165,184))
text(36,1870,"Собрано из нативной модели Minecraft 26.3. Экспорт сохраняет позу без ручного сброса поворота.",16,(146,164,180))
OUTPUT.parent.mkdir(parents=True,exist_ok=True)
image.resize((W,H),Image.Resampling.LANCZOS).save(OUTPUT)
print(OUTPUT)
