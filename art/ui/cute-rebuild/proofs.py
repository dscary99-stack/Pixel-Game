"""Review every delivered asset and animation; proofs stay outside public."""
from pathlib import Path
from PIL import Image,ImageDraw
import json,math
R=Path(__file__).resolve().parent;ROOT=R.parents[2];P=ROOT/'apps/client/public';O=R/'review'
M=json.loads((R/'manifest.json').read_text(encoding='utf8'));A=M['assets'];B={Path(a['file']).stem.removesuffix('_v002'):a for a in A}
def sprite(n,frame=0):
 a=B[n];im=Image.open(P/a['file'].lstrip('/')).convert('RGBA');w,h=a['frameWidth'],a['frameHeight'];return im.crop((frame*w,0,(frame+1)*w,h))
def nine(im,w,h):
 out=Image.new('RGBA',(w,h));sw,sh=im.size;sx=[0,16,sw-16,sw];sy=[0,16,sh-16,sh];tx=[0,16,w-16,w];ty=[0,16,h-16,h]
 for y in range(3):
  for x in range(3):out.paste(im.crop((sx[x],sy[y],sx[x+1],sy[y+1])).resize((tx[x+1]-tx[x],ty[y+1]-ty[y]),Image.Resampling.NEAREST),(tx[x],ty[y]))
 # Corners must be pixel-identical after reconstruction.
 for x,y,X,Y in [(0,0,0,0),(sw-16,0,w-16,0),(0,sh-16,0,h-16),(sw-16,sh-16,w-16,h-16)]:assert im.crop((x,y,x+16,y+16)).tobytes()==out.crop((X,Y,X+16,Y+16)).tobytes()
 return out
small=[a for a in A if a['frameWidth']<=64];pages=[]
for start in range(0,len(small),30):
 group=small[start:start+30];board=Image.new('RGBA',(1100,math.ceil(len(group)/5)*150+50),'#14121c');d=ImageDraw.Draw(board);d.text((16,12),'CUTE v002 / actual size + integer zoom / '+str(start+1)+'-'+str(start+len(group)),fill='#fff1c4')
 for j,a in enumerate(group):
  n=Path(a['file']).stem.removesuffix('_v002');x=12+(j%5)*220;y=48+(j//5)*150;d.text((x,y),n.removeprefix('ui_').removeprefix('item_'),fill='#fff1c4');f=sprite(n);board.alpha_composite(f,(x,y+24));z=min(4,max(2,100//max(f.size)));board.alpha_composite(f.resize((f.width*z,f.height*z),Image.Resampling.NEAREST),(x+72,y+24));d.text((x,y+132),f'{f.width}x{f.height} / {a["frameCount"]} frames',fill='#b9a7c6')
 filename=f'overview-{start//30+1:02}.png';board.convert('RGB').save(O/filename);pages.append(filename)
vfx=['ui_hit_'+e for e in ['fire','water','earth','wind','light','shadow','neutral']]+['ui_heal_burst']
board=Image.new('RGBA',(920,8*154),'#14121c');d=ImageDraw.Draw(board)
for j,n in enumerate(vfx):
 d.text((8,j*154+8),n,fill='#fff1c4')
 for i in range(6):board.alpha_composite(sprite(n,i).resize((128,128),Image.Resampling.NEAREST),(135+i*130,j*154+20))
board.convert('RGB').save(O/'vfx-review.png')

# A real-size assembly proof, explicitly not a game screenshot.
layout=Image.new('RGBA',(960,540),'#14121c');d=ImageDraw.Draw(layout)
layout.alpha_composite(nine(sprite('ui_window_frame'),928,508),(16,16))
d.text((42,35),'CUTE UI v002 / 960 x 540 assembly proof / runtime labels shown only in this preview',fill='#fff1c4')
for j,n in enumerate(['character','companion','inventory','activities','social']):
 x=38+j*180;layout.alpha_composite(nine(sprite('ui_button_selected' if n=='inventory' else 'ui_button_normal'),168,48),(x,62));layout.alpha_composite(sprite('ui_menu_'+n),(x+16,74));d.text((x+52,81),n,fill='#fff1c4')
items=['small_potion','phoenix_feather','mana_potion','cleansing_herb','stat_reset_scroll','skill_reset_scroll','crab_shell','fox_tail_ash','snail_glow_slime','mole_fur','bell_feather','crystal_shard','wooden_sword','training_bow','apprentice_staff','cloth_tunic','bell_feather_cap','crab_buckler','armor_crab_capture','ember_fox_capture','lantern_snail_capture','supply_mole_capture','bell_bird_capture','crystal_crab_lord_capture']
rarities=['common','uncommon','rare','epic','legendary']
for i,n in enumerate(items):
 x=42+(i%6)*74;y=144+(i//6)*74;layout.alpha_composite(sprite('ui_slot_64_'+rarities[i%5]),(x,y));layout.alpha_composite(sprite('item_'+n),(x+16,y+16))
for i,n in enumerate(['hp_ally','mp','exp','hp_enemy','ascend']):
 y=147+i*29;d.text((536,y),n,fill='#d3bfdc');layout.alpha_composite(sprite('ui_bar_track_h8').resize((228,8),Image.Resampling.NEAREST),(652,y+3));f=sprite('ui_bar_'+n+'_h8').resize((228,8),Image.Resampling.NEAREST);layout.alpha_composite(f.crop((0,0,[190,155,100,180,228][i],8)),(652,y+3))
for i,n in enumerate(['attack','skill','guard','potion','revive','capture','flee','ascend','auto']):
 x=535+(i%5)*70;y=322+(i//5)*62;layout.alpha_composite(nine(sprite('ui_button_primary' if n=='ascend' else 'ui_button_normal'),56,48),(x,y));layout.alpha_composite(sprite('ui_command_'+n),(x+16,y+12))
for i,n in enumerate(['stun','sleep','freeze','poison','burn','atk_up','def_up','regen','shield','reflect']):layout.alpha_composite(sprite('ui_status_'+n),(536+i*30,463))
d.text((42,493),'Items32px / command24px / status16px. New art only; Claude owns game integration.',fill='#d3bfdc');layout.convert('RGB').save(O/'layout-960x540.png')
base=sprite('ui_title_scene');base.save(O/'title-native.png');titleframes=[]
for i in range(6):
 frame=Image.new('RGBA',(580,540),'#14121c');frame.alpha_composite(base);frame.alpha_composite(sprite('ui_title_sparkles',i));titleframes.append(frame.convert('RGB'))
titleframes[0].save(O/'title-composite.gif',save_all=True,append_images=titleframes[1:],duration=125,loop=0,disposal=2)

entries=[]
for a in A:
 n=Path(a['file']).stem.removesuffix('_v002');entries.append(dict(name=n,url=n+'-strip.png',width=a['frameWidth'],height=a['frameHeight'],count=a['frameCount'],fps=a['animations'][0]['fps'] if a['animations'] else 0,loop=a['animations'][0]['loop'] if a['animations'] else False))
(O/'catalog.json').write_text(json.dumps(entries,indent=2)+'\n')
html='''<!doctype html><html lang="th"><meta charset="utf-8"><title>Pixel Game cute UI v002</title><style>body{background:#14121c;color:#ffefc4;font:16px system-ui;margin:24px}button,input,select{padding:8px;margin:5px;background:#49344f;color:#fff0c4;border:1px solid #c79fba;border-radius:8px}img,canvas{image-rendering:pixelated}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}article{background:#2d243b;padding:12px;overflow:auto;border-radius:12px}article h3{font-size:13px}figure{margin:0}header{position:sticky;top:0;background:#14121cee;padding:10px;z-index:2}.assembly{width:960px;max-width:100%}small{color:#c9b4d4}</style><header><h1>Cute UI v002</h1><p>364 assets · native pixel dimensions · preview, not an integrated game screen</p><input id="filter" placeholder="ค้นหาชื่อ เช่น status / item / hit"><button id="pause">หยุดแอนิเมชัน</button><label>ขยาย <select id="zoom"><option>1</option><option>2</option><option selected>4</option></select> เท่า</label><label><input type="checkbox" id="first">เฟรมแรกเท่านั้น</label></header><figure><img class="assembly" src="layout-960x540.png"><figcaption>ประกอบจากไฟล์จริงที่960×540 — ข้อความอยู่ใน preview เท่านั้น</figcaption></figure><p><a href="title-composite.gif">ภาพหน้าเกมและประกาย</a> · <a href="vfx-review.png">ทุกเฟรมของเอฟเฟกต์</a></p><main></main><details><summary>ภาพรวมทุกชิ้น</summary>'''+''.join('<p><a href="'+p+'">'+p+'</a></p>' for p in pages)+'''</details><script>
let paused=false,t=0,last=performance.now();const list=[];document.querySelector('#first').checked=matchMedia('(prefers-reduced-motion: reduce)').matches;
fetch('catalog.json').then(r=>r.json()).then(data=>{for(const a of data){let el=document.createElement('article');el.innerHTML='<h3>'+a.name+'</h3><small>'+a.width+'×'+a.height+' / '+a.count+' frames / '+(a.loop?'loop':'once/static')+'</small><p></p>';let c=document.createElement('canvas');c.width=a.width;c.height=a.height;el.append(c);document.querySelector('main').append(el);let im=new Image();im.src=a.url;list.push({a,el,c,im});}resize();});
function resize(){let z=+document.querySelector('#zoom').value;for(const {a,c}of list){let s=a.width>100?1:z;c.style.width=a.width*s+'px';c.style.height=a.height*s+'px';}}document.querySelector('#zoom').onchange=resize;
document.querySelector('#pause').onclick=e=>{paused=!paused;e.target.textContent=paused?'เล่นแอนิเมชัน':'หยุดแอนิเมชัน';};document.querySelector('#filter').oninput=e=>{for(const {a,el}of list)el.hidden=!a.name.includes(e.target.value.toLowerCase());};
function tick(now){if(!paused)t+=now-last;last=now;for(const {a,c,im,el}of list){if(el.hidden||!im.complete)continue;let frame=0;if(a.count>1&&!document.querySelector('#first').checked){let step=Math.floor(t*a.fps/1000);frame=a.loop?step%a.count:step%(a.count+Math.round(a.fps*.7));}let ctx=c.getContext('2d');ctx.clearRect(0,0,a.width,a.height);if(frame<a.count)ctx.drawImage(im,frame*a.width,0,a.width,a.height,0,0,a.width,a.height);}requestAnimationFrame(tick);}requestAnimationFrame(tick);
</script></html>'''
(O/'preview.html').write_text(html,encoding='utf8');print(json.dumps(dict(pages=len(pages),catalog=len(entries))))
