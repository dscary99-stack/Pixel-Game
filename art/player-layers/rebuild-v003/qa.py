"""Check native exports and decoded previews; visual approval is separate."""
import json, hashlib, argparse, shutil, zipfile
from pathlib import Path
from PIL import Image
import draw_cels as b

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--install',action='store_true');args=parser.parse_args()
 names=json.loads((b.A/'manifest.json').read_text(encoding="utf-8-sig"));errors=[];records=[];ids=set();frames=0
 allowed=set(b.PAL)|{c for ramp in b.KEY.values() for c in ramp}|{b.OUT,b.WHITE}
 for name in names:
  m=json.loads((b.ST/'metadata'/name).read_text(encoding="utf-8-sig"));p=b.ST/'sprites'/Path(m['file']).name;im=Image.open(p).convert('RGBA');n=m['frameCount'];frames+=n
  def check(ok,msg):
   if not ok:errors.append(name+': '+msg)
  check(m['assetId'] not in ids,'duplicate ID');ids.add(m['assetId'])
  check(im.size==(64*n,64),'sheet size');check(m['columns']==n and m['frameWidth']==m['frameHeight']==64,'grid')
  check(m['origin']==[.5,1] and m['groundOffset']==4 and m['headOffset']==[0,0],'anchor')
  check(m['status']=='grid_ready','status');pix=list(im.get_flattened_data());check(all(p[3] in [0,255] for p in pix),'partial alpha')
  colors={p[:3] for p in pix if p[3]};check(colors<=allowed,'off-palette')
  permitted=set(m['recolorParts'])
  for part,ramp in b.KEY.items():
   if part not in permitted:check(not(colors&set(ramp)),'foreign key '+part)
  clip=m['animations'][0];state=clip['name'];expected=2 if state=='hurt' else 6 if state.startswith('attack') or state=='cast' else 4
  fps=10 if state.startswith('attack') or state=='cast' else 8 if state in ['hurt','ko','walk'] else 6
  check(n==expected and clip['fps']==fps and clip['frames']==list(range(n)),'timing/frames')
  check(clip['loop']==(state in ['idle','walk']),'loop')
  if state.startswith('attack'):check(m.get('hitFrame')==3,'hitFrame')
  if state=='ko':check(m.get('holdLastFrame') is True,'KO hold')
  if m['layer']=='face' and m['assetId'].endswith('_up'):check(im.getbbox() is None,'up face not empty')
  bounds=[]
  for i in range(n):
   cel=im.crop((i*64,0,(i+1)*64,64));box=cel.getbbox();bounds.append(box)
   check(not box or (box[0]>0 and box[1]>0 and box[2]<64 and box[3]<64),'opaque edge contact frame '+str(i))
  records.append({'metadata':name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bounds':bounds})
 gifs=list((b.A/'review').glob('*.gif'))
 if len(gifs)!=336:errors.append('Expected 336 GIF previews')
 for p in gifs:
  im=Image.open(p);z=4 if p.stem.endswith('4x') else 1
  if im.size!=(64*z,64*z):errors.append(p.name+': GIF size')
  suffix=p.stem[8:-3];meta=next((json.loads((b.ST/'metadata'/n).read_text(encoding="utf-8-sig")) for n in names if n=='player_human_'+suffix+'_v003.json'),None)
  if not meta:errors.append(p.name+': missing clip');continue
  if im.n_frames!=meta['frameCount']:errors.append(p.name+': encoded frames')
  if ('loop' in im.info)!=meta['animations'][0]['loop']:errors.append(p.name+': loop extension')
 with zipfile.ZipFile(b.A/'native-cels.zip') as z:
  if len(z.namelist())!=720:errors.append('native cel archive count')
  for n in z.namelist():
   if z.read(n)!=(b.A/n).read_bytes():errors.append('archive mismatch '+n)
 report={'status':'pass' if not errors else 'fail','visualApproval':'needs_review','sheets':len(names),'frameSlots':frames,'gifs':len(gifs),'errors':errors,'files':records,'limitations':['Pixel scans validate key ownership by layer, not semantic anatomy.','Generated head angles are visually interpreted from rig; no numeric angle certification.','Preview compositing tested separately from the live game.']}
 previous=json.loads((b.A/'qa-report.json').read_text()) if (b.A/'qa-report.json').exists() else {}
 if 'projectCheck' in previous:report['projectCheck']=previous['projectCheck']
 (b.A/'qa-report.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({k:v for k,v in report.items() if k!='files'}));assert not errors
 if args.install:
  index=b.P/'metadata/index.json';existing=json.loads(index.read_text(encoding="utf-8-sig"));retained=[]
  for n in existing:
   m=json.loads((b.P/'metadata'/n).read_text(encoding="utf-8-sig"))
   if m['assetId'] not in ids:retained.append(n)
  for n in names:
   m=json.loads((b.ST/'metadata'/n).read_text(encoding="utf-8-sig"));shutil.copy2(b.ST/'metadata'/n,b.P/'metadata'/n);shutil.copy2(b.ST/'sprites'/Path(m['file']).name,b.P.parent/m['file'].lstrip('/'))
  index.write_text(json.dumps(sorted(retained+names),indent=2)+'\n')
  active=[json.loads((b.P/'metadata'/n).read_text(encoding="utf-8-sig"))['assetId'] for n in json.loads(index.read_text(encoding="utf-8-sig"))]
  assert len(active)==len(set(active));print('Installed',len(names),'exports; no duplicate indexed IDs')

if __name__=='__main__':main()
