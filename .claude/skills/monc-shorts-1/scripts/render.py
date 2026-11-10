#!/usr/bin/env python3
"""몬크 숏츠1번: 확정 글꼴과 픽셀 좌표로 발화 영상을 합성한다."""
import argparse, hashlib, json, math, os, subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SKILL=Path(__file__).resolve().parents[1]
S=json.loads((SKILL/'assets/style.json').read_text(encoding='utf-8'))
FONT=SKILL/'assets'/S['font']
if hashlib.sha256(FONT.read_bytes()).hexdigest()!=S['font_sha256']:
 raise ValueError('승인된 글꼴 파일과 다릅니다.')
W,H=S['canvas']; FPS=S['fps']; WHITE=tuple(S['white']); BLUE=tuple(S['blue']); NAVY=tuple(S['navy'])
FONTS={n:ImageFont.truetype(str(FONT),n) for n in (28,30,32,34,44,52,90)}

def glyph(value,size,tracking=None):
 tracking=S['tracking'] if tracking is None else tracking
 f=FONTS[size]; im=Image.new('L',(max(64,int(f.getlength(value)+len(value)*max(0,tracking)+50)),size*2)); d=ImageDraw.Draw(im); x=0
 for c in value:
  d.text((x,0),c,font=f,fill=255); x+=f.getlength(c)+tracking
 bbox=im.getbbox()
 # 승인본 워터마크의 간격은 보존하고 깨진 구분문자는 그리지 않는다.
 if any(c in value for c in S['header']['hidden_spacers']):
  cursor=0
  for c in value:
   if c in S['header']['hidden_spacers']:d.rectangle((math.floor(cursor)-2,0,math.ceil(cursor+f.getlength(c))+2,size*2),fill=0)
   cursor+=f.getlength(c)+tracking
 return im.crop(bbox) if bbox else Image.new('L',(1,1))

def text(im,xy,value,size=90,color=WHITE,shadow=False):
 mask=glyph(value,size); x,y=map(int,xy)
 if shadow:
  ss=S['shadow']; sm=mask.filter(ImageFilter.GaussianBlur(ss['blur'])); layer=Image.new('RGBA',mask.size,(0,0,0,ss['alpha'])); layer.putalpha(sm.point(lambda v:v*ss['alpha']//255)); im.alpha_composite(layer,(x+ss['offset'][0],y+ss['offset'][1]))
 layer=Image.new('RGBA',mask.size,tuple(color)); layer.putalpha(mask.point(lambda v:v*color[3]//255)); im.alpha_composite(layer,(x,y)); return mask.size

def wrap(value,size,width=None):
 width=S['main']['max_width'] if width is None else width; out=[]
 for line in value.split('\n'):
  if glyph(line,size).width<=width:out.append(line);continue
  current=''
  for word in line.split(' '):
   trial=(current+' '+word).strip()
   if current and glyph(trial,size).width>width:out.append(current);current=word
   else:current=trial
  if current:out.append(current)
 for line in out:
  if glyph(line,size).width>width:raise ValueError('한 단어가 자막 너비를 넘습니다: '+line)
 return out

def pill(im,label):
 p=S['pill']; m=glyph(label,p['size']); x,y=p['x'],p['y']; width=m.width+2*p['padding']
 if width>866:raise ValueError('구간 라벨을 더 짧게 정리하십시오.')
 ImageDraw.Draw(im).rounded_rectangle((x,y,x+width,y+p['height']),radius=p['radius'],fill=WHITE)
 text(im,(x+p['padding'],y+(p['height']-m.height)//2),label,p['size'],tuple(p['ink']))

def card(im,scene):
 p=S['card']; d=ImageDraw.Draw(im); d.rounded_rectangle(tuple(p['rect']),radius=p['radius'],fill=NAVY)
 if glyph(scene['header'],p['header_size']).width>792:raise ValueError('카드 제목이 너무 깁니다.')
 text(im,p['header_pos'],scene['header'],p['header_size'],BLUE); d.line(tuple(p['rule']),fill=tuple(p['rule_color']),width=1)
 if scene.get('summary'):
  if glyph(scene['summary'],p['size']).width>792:raise ValueError('카드 요약이 너무 깁니다.')
  text(im,p['left_pos'],scene['summary'],p['size'])
 else:
  if glyph(scene['left'],p['size']).width>340 or glyph(scene['right'],p['size']).width>298:raise ValueError('카드 본문이 두 열의 너비를 넘습니다.')
  text(im,p['left_pos'],scene['left'],p['size']);d.line(tuple(p['arrow']),fill=BLUE,width=1);d.line(tuple(p['head']),fill=BLUE,width=1);text(im,p['right_pos'],scene['right'],p['size'])

BASE=Image.new('RGBA',(W,H)); g=S['gradient']; bd=ImageDraw.Draw(BASE)
for y in range(g['start'],H):
 t=min(1,max(0,(y-g['start'])/(g['end']-g['start'])));a=round(g['alpha']*(t**g['power']));bd.line((0,y,W,y),fill=tuple(g['color'])+(a,))

def active(items,t):return next((a for a in items if a['start']-0.0001<=t<a['end']-0.0001),None)

def overlay(plan,t):
 im=BASE.copy();h=S['header'];text(im,h['pos'],h['text'],h['size'],tuple(h['color']),shadow=True)
 cue=next((c for c in plan['cues'] if c[0]-0.0001<=t<c[1]-0.0001),None)
 if not cue:return im
 intro=plan.get('intro')
 if intro and intro['start']-0.0001<=t<intro['end']-0.0001:
  pill(im,intro['label']);p=S['intro']
  if len(intro['title'])>2:raise ValueError('인트로 제목은 최대 두 줄입니다.')
  for i,line in enumerate(intro['title']):
   if glyph(line,p['title_size']).width>S['main']['max_width']:raise ValueError('인트로 제목이 너무 깁니다.')
   text(im,(p['title_pos'][0],p['title_pos'][1]+i*p['line_step']),line,p['title_size'],shadow=True)
  ImageDraw.Draw(im).line(tuple(p['underline']),fill=BLUE,width=p['underline_width'])
  for i,line in enumerate(wrap(cue[2],p['caption_size'])):text(im,(p['caption_pos'][0],p['caption_pos'][1]+i*p['caption_line_step']),line,p['caption_size'],shadow=True)
  return im
 label=active(plan.get('labels',[]),t);scene=active(plan.get('cards',[]),t)
 if label and scene:raise ValueError('구간 라벨과 설명 카드를 동시에 띄우지 마십시오.')
 if label:pill(im,label['text'])
 if scene:card(im,scene)
 m=S['main'];lines=wrap(cue[2],m['size']);start=m['card_y'] if scene else m['y']
 if len(lines)>m['max_lines']:raise ValueError('자막을 두 줄 안에 나누십시오: '+cue[2])
 for i,line in enumerate(lines):text(im,(m['x'],start+i*m['line_step']),line,m['size'],shadow=True)
 return im

def validate(plan):
 duration=float(plan['duration']);last=0
 if duration<=0:raise ValueError('영상 길이는 0보다 커야 합니다.')
 if not 0<=int(plan.get('frame_shift',0))<=400:raise ValueError('영상 위쪽 이동량은 0~400px에서 프리뷰로 확인하십시오.')
 for a,b,value in plan['cues']:
  if a<last-0.001 or not a<b or b>duration+0.05 or not isinstance(value,str):raise ValueError('자막 순서 또는 시간을 확인하십시오.')
  last=b
 for kind in ('labels','cards'):
  previous=0
  for item in plan.get(kind,[]):
   if item['start']<previous-0.001 or item['start']>=item['end'] or item['end']>duration+0.05:raise ValueError(kind+'의 구간을 확인하십시오.')
   previous=item['end']
 return duration

def generate(plan,out):
 duration=validate(plan);end=round(duration*FPS);bounds={0,end}
 for a,b,_ in plan['cues']:bounds.update((round(a*FPS),round(b*FPS)))
 for item in plan.get('labels',[])+plan.get('cards',[])+([plan['intro']] if plan.get('intro') else []):bounds.update((round(item['start']*FPS),round(item['end']*FPS)))
 bounds=sorted(b for b in bounds if 0<=b<=end);concat=['ffconcat version 1.0'];manifest=[]
 for i,(a,b) in enumerate(zip(bounds,bounds[1:])):
  name=f'overlay-{i:03d}.png';overlay(plan,(a+b)/(2*FPS)).save(out/name);concat.extend([f"file '{name}'",f'duration {(b-a)/FPS:.9f}']);manifest.append({'frame_start':a,'frame_end':b,'file':name})
 concat.append(f"file '{manifest[-1]['file']}'");(out/'overlays.ffconcat').write_text('\n'.join(concat)+'\n',encoding='utf-8');(out/'layout-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
 shift=int(plan.get('frame_shift',0));mask=Image.new('L',(W,H),255)
 if shift:
  finish=H-shift;begin=finish-S['reframe_blend'];d=ImageDraw.Draw(mask)
  for y in range(begin,H):d.line((0,y,W,y),fill=round(max(0,(finish-y)/S['reframe_blend'])*255))
 mask.save(out/'reframe-mask.png')
 return duration

def graph(plan,preview=False):
 shift=int(plan.get('frame_shift',0));scale=f'scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,crop={W}:{H}'
 if shift:
  v=f'[0:v]{scale},split=2[under][top];[top]crop={W}:{H-shift}:0:{shift},pad={W}:{H}:0:0:black[shift];[shift][2:v]alphamerge[shiftalpha];[under][shiftalpha]overlay=0:0[base];'
 else:v=f'[0:v]{scale}[base];'
 return v+'[base][1:v]overlay=0:0:format=auto'+(',scale=375:666' if preview else '')+'[out]'

def invoke(command,out):
 flags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0
 with (out/'render.log').open('a',encoding='utf-8') as log:result=subprocess.run(command,stdout=log,stderr=log,creationflags=flags)
 if result.returncode:raise RuntimeError('FFmpeg 실행 실패. '+str(out/'render.log')+'를 확인하십시오.')

def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--plan',type=Path,required=True);ap.add_argument('--input',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);ap.add_argument('--ffmpeg',default='ffmpeg');ap.add_argument('--preview-only',action='store_true');ap.add_argument('--audio-mode',choices=['copy','aac'],default='copy');args=ap.parse_args()
 plan=json.loads(args.plan.read_text(encoding='utf-8'));out=args.out.resolve();out.mkdir(parents=True,exist_ok=True);source=args.input.resolve()
 if not source.is_file():raise FileNotFoundError(source)
 duration=generate(plan,out);shift=int(plan.get('frame_shift',0))
 times=plan.get('preview_times',[min(2,duration/4),duration/2,max(0,duration-1)])
 for i,t in enumerate(times):
  if not 0<=t<duration:raise ValueError('프리뷰 시간이 영상 범위를 넘습니다.')
  image=out/f'preview-overlay-{i:02d}.png';overlay(plan,t).save(image)
  cmd=[args.ffmpeg,'-hide_banner','-loglevel','warning','-ss',str(t),'-i',str(source),'-i',str(image)]
  if shift:cmd+=['-i',str(out/'reframe-mask.png')]
  cmd+=['-filter_complex',graph(plan,True),'-map','[out]','-frames:v','1','-y',str(out/f'preview-{i:02d}.png')];invoke(cmd,out)
 print('프리뷰 생성 완료: '+str(out),flush=True)
 if args.preview_only:return
 cmd=[args.ffmpeg,'-hide_banner','-loglevel','warning','-i',str(source),'-f','concat','-safe','0','-i',str(out/'overlays.ffconcat')]
 if shift:cmd+=['-loop','1','-framerate',str(FPS),'-i',str(out/'reframe-mask.png')]
 e=S['encoding'];cmd+=['-filter_complex',graph(plan),'-map','[out]','-map','0:a:0?','-t',str(duration),'-r',str(FPS),'-c:v','libx264','-preset',e['preset'],'-crf',str(e['crf']),'-maxrate',e['maxrate'],'-bufsize',e['bufsize'],'-pix_fmt','yuv420p','-c:a',args.audio_mode]
 if args.audio_mode=='aac':cmd+=['-b:a','160k']
 cmd+=['-map_metadata','-1','-movflags','+faststart','-y',str(out/'MONC_shorts1.mp4')];invoke(cmd,out);print('영상 출력 완료: '+str(out/'MONC_shorts1.mp4'),flush=True)

if __name__=='__main__':main()
