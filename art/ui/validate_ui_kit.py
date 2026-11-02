"""Validate exported files and actual nine-slice placement proof (no rebuild)."""
import hashlib,json,re
from pathlib import Path
from PIL import Image,ImageChops
ROOT=Path(__file__).resolve().parents[2]
meta=ROOT/'apps/client/public/assets/metadata'
manifest=json.loads((ROOT/'art/ui/ui-kit-manifest.json').read_text())
assert len(manifest['assets'])==51
indexed=json.loads((meta/'index.json').read_text())
pngs=list((ROOT/'apps/client/public/assets/sprites/ui').glob('*.png'))
assert len(pngs)>=51  # Round 2 adds assets; v001's owned set stays exactly 51.
families={}
for a in manifest['assets']:
 path=ROOT/'apps/client/public'/a['file'].lstrip('/')
 assert re.fullmatch(r'ui_[a-z0-9_]+_v001.png',path.name),path
 assert path.with_suffix('.json').name in indexed
 assert json.loads((meta/path.with_suffix('.json').name).read_text())==a
 assert hashlib.sha256(path.read_bytes()).hexdigest()==a['sha256']
 with Image.open(path) as image:
  assert image.mode=='RGBA'
  assert image.size==(a['frameWidth'],a['frameHeight'])
  assert set(image.getchannel('A').getdata())<={0,255},path
  assert image.getbbox() is not None
  assert a['status']=='grid_ready' and not a['productionApproved']
  assert a['frameCount']==1 and a['origin']==[0,0]
  if a['kind']=='nine_slice':
   n=a['nineSlice'];assert (n['left'],n['right'],n['top'],n['bottom'])==(16,16,16,16)
   # Stretchable interior strips must be constant along the stretched axis.
   for x in range(17,image.width-16):
    assert image.crop((x,0,x+1,image.height)).tobytes()==image.crop((16,0,17,image.height)).tobytes(),path
   # Window frame/title scale on both axes; buttons maintain native height.
   if a['assetId'].startswith('ui:window'):
    for y in range(17,image.height-16):
     assert image.crop((0,y,image.width,y+1)).tobytes()==image.crop((0,16,image.width,17)).tobytes(),path
 families[a['kind']]=families.get(a['kind'],0)+1
# Actual rendered proof retains all four 16x16 window corners.
source=Image.open(ROOT/'apps/client/public/assets/sprites/ui/ui_window_frame_v001.png').convert('RGBA')
proof=Image.open(ROOT/'art/ui/ui-layout-proof-960x540-v001.png').convert('RGBA')
assert proof.size==(960,540)
bg=(20,18,28,255)
for sx,sy,dx,dy in [(0,0,24,24),(32,0,920,24),(0,32,24,500),(32,32,920,500)]:
 expected=Image.new('RGBA',(16,16),bg);expected.alpha_composite(source.crop((sx,sy,sx+16,sy+16)))
 assert expected.tobytes()==proof.crop((dx,dy,dx+16,dy+16)).tobytes()
result={'assetCount':len(manifest['assets']),'families':families,'rgba':True,'binaryAlpha':True,
 'manifestAndHashes':'pass','nativeDimensions':'pass','nineSliceAxisContinuity':'pass',
 'actualProofCorners':'pass','visualReview':'native sheet, 960x540 placement and light/dark icon sheet inspected',
 'gameIntegration':'not performed; Claude owns renderer','mobileFIT':'pending'}
(ROOT/'art/ui/qa-report-v001.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))

