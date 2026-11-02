"""Native 580x540 re-authored composition from title-concept-r2.png.
No resizing or sampling the AI bitmap; each polygon/cluster is on the final grid.
"""
from r2_motifs import *
import math,random
def title_layers():
 im=canvas(580,540);d=ImageDraw.Draw(im);rng=random.Random(29)
 # Broken arch silhouette, masonry blocks and a transparent skyline.
 poly(d,[(86,380),(86,238),(109,238),(109,205),(133,205),(133,169),(166,169),(166,146),(209,146),(209,130),(275,130),(275,145),(321,145),(321,169),(352,169),(352,208),(374,208),(374,384),(328,384),(328,235),(309,235),(309,202),(279,202),(279,181),(215,181),(215,199),(181,199),(181,231),(157,231),(157,380)],P['rim'])
 for x,y,w,h in [(90,242,60,36),(90,282,60,37),(90,323,60,40),(111,208,64,28),(137,172,65,30),(170,149,66,27),(240,134,32,43),(278,150,38,43),(320,173,29,56),(333,240,37,39),(333,283,37,40),(333,328,37,45)]:
  d.rectangle((x,y,x+w,y+h),fill=P['panel'],outline=O);d.line([(x+2,y+h-2),(x+2,y+2),(x+w-2,y+2)],fill=P['light']);d.line([(x+5,y+h-6),(x+w-5,y+h-6)],fill=P['rim'])
 # Hanging vine clusters, all grid aligned and fixed during the loop.
 for vx,vy in [(145,177),(322,181),(109,277)]:
  d.line([(vx,vy),(vx-4,vy+22),(vx+3,vy+43),(vx-2,vy+69)],fill=P['green'],width=2)
  for j in range(7):
   x=vx+(-6 if j%2 else 1);y=vy+j*9;d.rectangle((x,y,x+6,y+4),fill=P['green']);d.rectangle((x+1,y+1,x+3,y+2),fill=P['teal'])
 # Crescent: polygon cutout preserves alpha.
 poly(d,[(441,141),(421,143),(405,154),(397,172),(398,194),(411,209),(430,215),(450,211),(463,198),(444,202),(427,196),(418,181),(421,162)],P['gold'])
 d.line([(411,161),(406,172),(406,189),(415,201),(432,207)],fill=P['cream'],width=3)
 # Floating island, stepped facets and moss ledge.
 poly(d,[(45,391),(80,372),(162,360),(243,365),(319,357),(415,371),(508,394),(534,421),(509,448),(475,458),(452,496),(414,481),(391,515),(348,491),(306,520),(265,493),(233,514),(201,481),(159,488),(135,459),(84,447)],P['panel'])
 for pts,c in [([(81,414),(130,423),(135,459),(112,448)],'rim'),([(149,423),(203,432),(201,481),(178,466)],'rim'),([(220,430),(271,433),(265,493),(246,481)],'light'),([(290,428),(333,423),(306,520)],'rim'),([(355,420),(397,419),(391,515),(374,476)],'rim'),([(427,418),(479,414),(452,496)],'light'),([(486,417),(516,417),(509,448),(476,460)],'rim')]:poly(d,pts,P[c])
 poly(d,[(46,391),(92,377),(162,366),(241,373),(319,364),(411,378),(506,397),(522,415),(483,428),(404,439),(319,435),(243,445),(167,434),(97,426),(52,415)],P['green'])
 poly(d,[(70,397),(138,382),(224,387),(305,379),(402,390),(483,404),(490,415),(413,423),(320,419),(245,429),(162,419),(95,414)],P['brass'])
 for _ in range(85):
  x=rng.randrange(65,510);y=rng.randrange(386,432)
  if im.getpixel((x,y))[:3] in ((114,191,131),(188,136,81)):
   d.rectangle((x,y,x+rng.choice([2,3,5]),y+1),fill=rng.choice([P['cream'],P['green'],P['gold']]))
 # Lantern snail body with fixed head, stalks, original chunky shell.
 poly(d,[(149,382),(175,370),(244,367),(276,341),(293,305),(314,296),(331,307),(333,336),(321,365),(319,383),(341,393),(333,402),(205,405),(158,398),(140,392)],P['gold'])
 d.line([(163,391),(211,395),(284,394),(317,387)],fill=P['cream'],width=3)
 poly(d,[(299,306),(292,282),(291,267),(297,263),(302,269),(304,299)],P['cream']);poly(d,[(322,305),(333,279),(341,275),(345,281),(329,314)],P['cream'])
 for x,y in [(295,268),(341,280)]:gem(d,x,y,P['gold'],7);gem(d,x,y,P['cream'],3)
 d.rectangle((306,320,312,329),fill=O);d.rectangle((308,321,310,323),fill=P['cream']);d.rectangle((321,322,326,330),fill=O);d.rectangle((321,322,323,324),fill=P['cream']);d.line([(313,341),(318,343),(323,340)],fill=O,width=2)
 poly(d,[(149,362),(132,345),(123,312),(130,276),(151,252),(185,237),(220,241),(246,262),(261,294),(256,332),(237,358),(206,376),(176,374)],P['brass'])
 poly(d,[(145,337),(139,305),(151,276),(177,257),(211,256),(235,276),(244,308),(231,338),(206,355),(175,356)],P['gold'])
 d.line([(157,327),(153,304),(166,282),(188,271),(212,277),(227,296),(226,318),(211,335),(190,338),(174,327),(170,311),(179,296),(194,290),(207,300),(209,312),(199,321),(189,316),(187,307)],fill=P['brass'],width=6)
 d.line([(145,294),(156,275),(178,260),(207,259)],fill=P['cream'],width=3)
 # Lantern cap and fixed glass glints.
 poly(d,[(167,242),(174,229),(181,229),(184,216),(196,216),(200,229),(209,229),(217,243)],P['brass']);d.line((175,235,207,235),fill=P['gold'],width=2)
 spark(d,220,302,P['cream'],7);d.rectangle((147,311,150,324),fill=P['cream'])
 # Crystal crab, asymmetric claws, six articulated native legs.
 for x,side in [(394,-1),(422,1)]:
  for j in range(3):d.line([(x,381+j*5),(x+side*17,383+j*5),(x+side*22,391+j*5)],fill=O,width=5);d.line([(x,381+j*5),(x+side*17,383+j*5),(x+side*22,391+j*5)],fill=P['blue'],width=2)
 poly(d,[(384,373),(391,358),(411,353),(429,362),(433,378),(422,392),(397,391)],P['blue'])
 for x,y in [(394,360),(408,353),(422,363)]:poly(d,[(x-5,y+8),(x-5,y-3),(x,y-14),(x+5,y-3),(x+4,y+8)],P['purple']);d.line([(x,y-10),(x+2,y+2)],fill=P['cream'],width=2)
 for x,y in [(399,373),(418,373)]:d.rectangle((x-3,y-2,x+3,y+5),fill=O);d.rectangle((x-1,y-1,x+1,y+1),fill=P['cream'])
 d.line((406,386,412,386),fill=O,width=2)
 for x,y in [(373,373),(447,366)]:poly(d,[(x-9,y),(x-7,y-11),(x,y-17),(x+3,y-7),(x+7,y-14),(x+10,y-5),(x+6,y+6),(x-3,y+8)],P['blue']);d.line((x-6,y-5,x-3,y-11),fill=P['cream'],width=2)
 # Original pixel logo, production text exception; not a bundled font.
 glyphs={'P':['11110','10001','10001','11110','10000','10000','10000'],'I':['111','010','010','010','010','010','111'],'X':['10001','10001','01010','00100','01010','10001','10001'],'E':['11111','10000','10000','11110','10000','10000','11111'],'L':['10000','10000','10000','10000','10000','10000','11111'],'G':['01111','10000','10000','10111','10001','10001','01110'],'A':['01110','10001','10001','11111','10001','10001','10001'],'M':['10001','11011','10101','10101','10001','10001','10001']}
 text='PIXEL GAME';unit=5;width=sum((len(glyphs[ch][0])+1)*unit if ch!=' ' else 3*unit for ch in text)-unit;x=(580-width)//2
 for ch in text:
  if ch==' ':x+=3*unit;continue
  for yy,row in enumerate(glyphs[ch]):
   for xx,v in enumerate(row):
    if v=='1':d.rectangle((x+xx*unit-2,42+yy*unit-2,x+(xx+1)*unit+1,42+(yy+1)*unit+3),fill=O)
  for yy,row in enumerate(glyphs[ch]):
   for xx,v in enumerate(row):
    if v=='1':d.rectangle((x+xx*unit,42+yy*unit,x+(xx+1)*unit-1,42+(yy+1)*unit-1),fill=P['cream'] if yy<2 else P['gold'] if yy<5 else P['brass'])
  x+=(len(glyphs[ch][0])+1)*unit
 d.line((180,95,400,95),fill=P['rim']);gem(d,290,95,P['gold'],4)
 overlays=[]
 stars=[(89,175),(373,141),(479,241),(195,122),(460,327),(71,319),(350,105),(257,213),(219,302),(297,267)]
 for f in range(6):
  fr=canvas(580,540);dd=ImageDraw.Draw(fr)
  for k,(x,y) in enumerate(stars):
   phase=(f+k*2)%6;r=[0,1,2,1,0,1][phase];spark(dd,x,y,P['cream'] if phase==2 else P['gold'],r)
  # Two drifting fireflies on closed, pixel-snapped paths.
  for k,(x,y) in enumerate([(272,304),(356,321)]):
   ang=(f/6+k*.5)*math.tau;xx=x+round(math.cos(ang)*5);yy=y+round(math.sin(ang)*3);dd.rectangle((xx,yy,xx+1,yy+1),fill=P['teal'])
  overlays.append(fr)
 return im,overlays
