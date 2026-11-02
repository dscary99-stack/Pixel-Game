"""Original native integer-coordinate motifs. Palette inherited from UI v001."""
from PIL import Image, ImageDraw
P=dict(bg='#14121c',outline='#0c0b14',panel='#242033',rim='#625770',light='#b9a7bf',brass='#bc8851',gold='#efc477',cream='#fff0bc',teal='#4fc5b0',blue='#5c9ded',purple='#be82e9',red='#e26779',green='#72bf83',muted='#797383',white='#e4e6ec')
O=P['outline']
def canvas(w,h=None):return Image.new('RGBA',(w,h or w))
def poly(d,p,c):
 d.polygon(p,fill=c);d.line(p+[p[0]],fill=O,width=1)
def spark(d,x,y,c,r=2):
 d.line((x-r,y,x+r,y),fill=c);d.line((x,y-r,x,y+r),fill=c)
def gem(d,x,y,c,r=3):poly(d,[(x,y-r),(x+r,y),(x,y+r),(x-r,y)],c)
def symbol(name,c=None):
 c=c or P['gold'];im=canvas(16);d=ImageDraw.Draw(im);hi=P['cream']
 def line(p,col=c,w=1):d.line(p,fill=col,width=w)
 def box(b,col=c):d.rectangle(b,fill=col)
 if name=='flame':
  poly(d,[(7,1),(10,5),(10,8),(13,5),(14,10),(11,14),(5,14),(2,11),(3,7),(5,9),(5,5)],c);poly(d,[(8,6),(10,10),(8,13),(6,11)],hi)
 elif name=='drop':
  poly(d,[(8,1),(13,9),(13,12),(10,14),(5,14),(2,11),(3,8)],c);line([(5,9),(5,11),(7,12)],hi)
 elif name=='rock':
  poly(d,[(4,3),(10,2),(14,8),(12,13),(3,14),(1,9)],c);line([(4,4),(9,4),(11,7)],hi);line([(9,5),(7,9),(11,13)],O)
 elif name=='wind':
  line([(1,5),(10,5),(12,3),(10,1),(8,2)],c,2);line([(3,9),(14,9)],hi,2);line([(1,12),(8,12),(10,14),(12,13)],c)
 elif name=='star':
  poly(d,[(8,1),(10,5),(14,7),(10,9),(8,14),(6,10),(1,8),(6,6)],c);spark(d,8,7,hi,2)
 elif name=='moon':poly(d,[(9,1),(5,2),(2,5),(2,10),(5,13),(10,14),(14,10),(9,10),(6,7),(7,3)],c)
 elif name=='slash':
  poly(d,[(2,12),(11,2),(14,1),(12,6),(4,14)],c);line([(5,10),(11,4)],hi)
 elif name=='bolt':poly(d,[(8,1),(13,1),(9,6),(13,6),(4,14),(6,9),(2,9)],c)
 elif name=='shield':
  poly(d,[(2,3),(8,1),(13,3),(12,10),(8,14),(3,11)],c);line([(8,4),(8,10)],hi);line([(5,7),(10,7)],hi)
 elif name=='sword':
  poly(d,[(4,10),(10,2),(13,1),(13,4),(6,12)],c);line([(3,8),(8,13)],P['brass'],2);line([(4,12),(2,14)],P['brass'],2);line([(7,7),(11,3)],hi)
 elif name=='staff':
  line([(4,14),(10,5)],O,3);line([(4,14),(10,5)],P['brass']);gem(d,11,3,c,3)
 elif name=='bow':
  line([(3,2),(9,3),(12,6),(12,10),(9,13),(3,14)],c,2);line([(3,2),(3,14)],hi);line([(2,11),(12,3)],hi);line([(9,3),(13,2),(12,6)],c)
 elif name=='heart':
  poly(d,[(1,5),(3,2),(6,2),(8,4),(10,2),(13,2),(15,5),(13,9),(8,14),(3,9)],c);line([(3,5),(5,4)],hi)
 elif name=='eye':
  poly(d,[(1,8),(5,4),(10,4),(14,8),(10,12),(5,12)],c);box((6,5,9,10),O);box((7,5,8,7),hi)
 elif name=='skull':
  poly(d,[(4,2),(11,2),(14,5),(13,10),(10,11),(10,14),(5,14),(5,11),(2,10),(1,5)],c);box((3,6,5,8),O);box((9,6,11,8),O);box((7,10,8,11),O);line([(7,12),(7,14)],O)
 elif name=='mouth':
  poly(d,[(2,5),(6,3),(9,3),(13,5),(14,10),(11,13),(4,13),(1,10)],c);box((4,7,11,10),O);line([(4,7),(11,7)],hi)
 elif name=='root':
  line([(8,1),(8,8),(4,11),(2,14)],c,2);line([(8,8),(12,11),(14,14)],c,2);line([(7,8),(7,14)],hi);line([(3,4),(5,6),(8,6),(11,4)],c)
 elif name=='chain':
  d.ellipse((1,7,8,14),outline=c,width=2);d.ellipse((7,1,14,8),outline=c,width=2);line([(6,10),(10,6)],hi,2)
 elif name=='bottle':
  box((6,1,10,4),P['brass']);poly(d,[(5,4),(11,4),(11,7),(14,10),(13,14),(3,14),(2,10),(5,7)],c);line([(5,9),(5,12)],hi)
 elif name=='leaf':
  poly(d,[(2,13),(2,7),(7,2),(14,1),(13,8),(8,12)],c);line([(3,12),(11,4)],hi);line([(7,8),(7,5)],hi)
 elif name=='feather':
  poly(d,[(2,14),(3,7),(8,2),(14,1),(13,7),(8,12)],c);line([(2,14),(11,4)],P['brass']);line([(8,6),(12,6)],hi)
 elif name=='clock':
  d.ellipse((1,1,14,14),fill=c,outline=O);d.ellipse((3,3,12,12),fill=P['panel']);line([(7,4),(7,8),(10,8)],hi)
 elif name=='lock':
  d.arc((4,1,11,10),180,360,fill=c,width=2);box((2,6,13,14),O);box((3,7,12,13),c);box((7,9,8,11),O)
 elif name=='person':
  d.ellipse((5,1,10,6),fill=c,outline=O);poly(d,[(5,7),(10,7),(13,11),(12,14),(3,14),(2,11)],c);line([(6,8),(8,10),(10,8)],hi)
 elif name=='boot':
  poly(d,[(5,2),(11,2),(10,9),(14,11),(14,14),(3,14),(2,11),(5,9)],c);line([(5,12),(12,12)],hi)
 elif name=='helmet':
  poly(d,[(3,5),(6,2),(10,2),(13,6),(13,13),(9,11),(6,13),(2,12)],c);line([(4,7),(11,7)],O,2);line([(8,3),(8,5)],hi)
 elif name=='armor':
  poly(d,[(5,2),(7,4),(9,4),(11,2),(15,5),(12,9),(11,7),(12,14),(3,14),(4,7),(2,9),(0,5)],c);line([(5,6),(10,6)],hi);line([(7,7),(7,12)],P['rim'])
 elif name=='scroll':
  poly(d,[(2,1),(13,1),(14,4),(12,5),(12,12),(14,13),(12,15),(2,15),(1,12),(3,11),(3,4),(1,3)],c);line([(5,5),(10,5)],P['brass']);line([(5,8),(9,8)],P['brass']);gem(d,10,12,P['red'],2)
 elif name=='coin':
  d.ellipse((2,1,13,14),fill=c,outline=O);d.ellipse((4,3,11,12),outline=hi);line([(7,5),(7,10)],hi,2)
 elif name=='shell':
  poly(d,[(1,10),(2,5),(5,2),(10,2),(14,6),(14,11),(9,14),(5,14)],c);line([(3,6),(10,5),(12,8),(9,11),(6,10),(6,8),(9,8)],hi)
 elif name=='paw':
  for b in [(1,3,4,7),(5,1,7,5),(9,1,11,5),(12,3,14,7)]:d.ellipse(b,fill=c,outline=O)
  poly(d,[(5,8),(10,8),(13,12),(11,14),(8,12),(5,14),(2,12)],c)
 elif name=='crab':
  d.ellipse((4,5,11,12),fill=c,outline=O);line([(5,8),(1,6),(1,2)],c,2);line([(10,8),(14,6),(14,2)],c,2);line([(4,11),(2,14)],c);line([(11,11),(13,14)],c);box((6,6,6,6),hi);box((9,6,9,6),hi)
 elif name=='fox':
  poly(d,[(2,1),(7,4),(9,4),(14,1),(13,10),(8,14),(3,10)],c);box((4,7,5,8),O);box((10,7,11,8),O);gem(d,8,11,hi,2)
 elif name=='bell':
  poly(d,[(7,1),(9,1),(10,4),(12,6),(12,10),(14,12),(2,12),(4,10),(4,6),(6,4)],c);box((7,13,9,14),P['brass']);line([(6,6),(6,9)],hi)
 elif name=='mail':
  poly(d,[(1,4),(14,4),(14,13),(1,13)],c);line([(2,5),(7,9),(13,5)],P['brass']);gem(d,8,10,P['red'],2)
 elif name=='chest':
  poly(d,[(2,3),(12,3),(14,6),(14,14),(1,14),(1,6)],c);box((2,8,13,9),O);box((7,7,9,11),hi);line([(4,4),(4,13)],P['brass'])
 elif name=='hammer':
  line([(4,14),(10,5)],P['brass'],3);poly(d,[(3,2),(5,0),(14,6),(12,9)],c);line([(5,2),(12,6)],hi)
 elif name=='tower':
  poly(d,[(2,1),(5,1),(5,4),(7,4),(7,1),(10,1),(10,4),(12,4),(12,1),(14,1),(13,7),(12,7),(12,14),(3,14),(3,7),(2,7)],c);box((6,9,9,14),O);box((7,6,8,7),hi)
 elif name=='book':
  poly(d,[(1,2),(6,2),(8,4),(10,2),(14,2),(14,13),(10,13),(8,15),(6,13),(1,13)],c);line([(8,5),(8,12)],P['brass']);line([(3,5),(5,5)],hi);line([(10,8),(12,8)],hi)
 elif name=='tree':
  line([(8,14),(8,4)],P['brass'],2);line([(3,6),(3,9),(12,9),(12,5)],P['brass']);gem(d,8,3,c,3);gem(d,3,6,c,2);gem(d,12,5,c,2)
 elif name=='lyre':
  line([(3,2),(3,10),(6,14),(10,14),(13,10),(13,2)],c,2);line([(3,4),(13,4)],hi);line([(6,5),(6,11)],hi);line([(9,5),(9,12)],hi)
 elif name=='mask':
  poly(d,[(2,3),(7,5),(13,2),(14,9),(11,13),(5,14),(2,10)],c);line([(4,7),(6,8)],O,2);line([(9,7),(12,6)],O,2);line([(6,11),(10,10)],O)
 elif name=='wing':
  poly(d,[(2,14),(2,8),(5,4),(14,1),(12,5),(8,7),(12,6),(10,10),(7,11),(8,12)],c);line([(4,11),(8,7)],hi)
 elif name=='crown':
  poly(d,[(1,4),(5,7),(8,2),(11,7),(14,4),(12,13),(3,13)],c);gem(d,8,10,hi,2)
 elif name=='target':
  d.ellipse((2,2,13,13),outline=c,width=2);spark(d,8,8,hi,2);line([(0,8),(3,8)],c);line([(8,0),(8,3)],c)
 elif name=='fist':
  poly(d,[(3,4),(5,2),(7,3),(9,2),(11,3),(13,5),(13,10),(10,14),(4,13),(1,9),(1,6)],c);line([(5,5),(5,8)],hi);line([(8,4),(8,7)],hi)
 else:raise ValueError('Missing motif '+name)
 return im

def framed_symbol(motif,size,color=P['gold']):
 im=canvas(size);d=ImageDraw.Draw(im)
 if size==32:
  poly(d,[(8,2),(23,2),(29,8),(29,23),(23,29),(8,29),(2,23),(2,8)],P['panel']);d.line([(8,3),(23,3),(28,8)],fill=P['brass']);d.line([(3,22),(8,28),(22,28)],fill=P['rim'])
 im.alpha_composite(symbol(motif,color),((size-16)//2,(size-16)//2))
 return im
