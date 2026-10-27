const GLS={"common": "precision highp float;\nuniform vec2 R;uniform float T;uniform float P;uniform float W;uniform float F;\nfloat h11(float p){p=fract(p*.1031);p*=p+33.33;p*=p+p;return fract(p);}\nfloat h21(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}\nvec2 h22(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));q+=dot(q,q.yzx+33.33);return fract((q.xx+q.yz)*q.zy);}\nfloat n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x),mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x),f.y);}\nfloat fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*n2(p);p=p*2.03+vec2(17.1,9.2);a*=.5;}return s;}\nfloat fbm3(vec2 p){float a=.5,s=0.;for(int i=0;i<3;i++){s+=a*n2(p);p=p*2.03+vec2(17.1,9.2);a*=.5;}return s;}\nvec3 L(vec3 c){return pow(c,vec3(2.2));}\nvec3 fin(vec3 c,vec2 fc){c=(c*(2.51*c+.03))/(c*(2.43*c+.59)+.14);c=pow(clamp(c,0.,1.),vec3(.4545));return c+(h21(fc+fract(T))-.5)/200.;}\n", "aurora": "const float hz=.27;\nfloat ridge(float x,float s,float a){float n=fbm3(vec2(x*s,3.1));float r=1.-abs(2.*fbm3(vec2(x*s*2.1,7.7))-1.);return a*(.5*n+.5*r*r);}\nfloat starL(vec2 q,float S,float thr){vec2 g=q*S,id=floor(g),f=fract(g)-.5;float r=h21(id);if(r<thr)return 0.;vec2 o=(h22(id)-.5)*.6;float d=length(f-o);float tw=.75+.25*sin(T*(1.+r*3.)+r*50.);return exp(-d*d*(140.+r*500.))*tw*(.25+(r-thr)/(1.-thr)*1.6);}\nvec3 curtain(vec2 q,float seed,float I){\n  float x=q.x*1.4+seed*3.;\n  float wv=fbm3(vec2(x*.6+T*.015,seed))*1.6+.25*sin(x*1.7+T*.1+seed);\n  float base=.40+.22*wv+seed*.025;\n  float h=q.y-base;\n  float top=.10+.13*fbm3(vec2(x*1.3-T*.012,seed+4.));\n  float ray=pow(fbm3(vec2(x*40.+wv*14.,seed*9.+T*.035)),1.4);\n  float env=smoothstep(-.02,.05,h)*exp(-max(h,0.)/top*2.4);\n  vec3 col=mix(vec3(.85,.10,.40),vec3(.10,1.,.45),smoothstep(.0,.07,h));\n  col=mix(col,vec3(.14,.50,1.),smoothstep(.14,.36,h));\n  return col*env*(.16+1.3*ray)*I;\n}\nvec3 aurora(vec2 q,float I){\n  vec3 c=vec3(0.);\n  for(int i=0;i<3;i++)c+=curtain(q,float(i)*1.9+.3,I)*(.78-.16*float(i));\n  return c;\n}\nvec3 sky(vec2 q,float I){\n  float y=clamp((q.y-hz)/(1.-hz),0.,1.);\n  vec3 c=mix(L(vec3(.07,.16,.21)),L(vec3(.008,.016,.055)),pow(y,.45));\n  vec2 m=q-vec2(.85,.75);float d=dot(m,normalize(vec2(.6,-.8)));\n  float mw=exp(-d*d*8.)*(.4+.9*fbm3(q*6.));\n  c+=L(vec3(.55,.6,.85))*mw*.06*smoothstep(.4,1.,y);\n  float st=starL(q,300.,.972)+starL(q,120.,.985)*1.6+starL(q,50.,.992)*2.5;\n  c+=vec3(.85,.9,1.)*st*(.5+mw*3.)*smoothstep(.15,.6,y);\n  c+=aurora(q,I);\n  return c;\n}\nvoid main(){\n  vec2 q=gl_FragCoord.xy/R.y;float asp=R.x/R.y;float I=.45+.55*P;\n  vec2 qs=q;float lake=0.;\n  if(q.y<hz){lake=1.;qs.y=hz+(hz-q.y)*2.1;qs.x+=sin(q.y*110.+T*1.1)*.0016*(hz-q.y)*9.+(n2(vec2(q.x*50.,q.y*300.+T*.5))-.5)*.006;}\n  vec3 col=sky(qs,I);\n  vec3 ag=vec3(.12,.85,.40)*(.3+.7*fbm3(vec2(qs.x*1.6+T*.02,2.)))*I*.5;\n  float hf=hz+.05+ridge(qs.x*.8+.7,1.6,.30);\n  float hn=hz+.005+ridge(qs.x*1.1+3.2,2.6,.13);\n  if(qs.y<hf){\n    float k=hf-qs.y;\n    float sn=smoothstep(.07,.0,k+.025*fbm3(qs*30.))*smoothstep(.2,.65,fbm3(qs*vec2(12.,26.)+2.));\n    vec3 mc=L(vec3(.045,.07,.12))+ag*.05+L(vec3(.03,.05,.08))*smoothstep(.2,.0,k);\n    mc=mix(mc,L(vec3(.6,.75,.85))*(.18+ag*.9),sn*.9);\n    mc=mix(mc,L(vec3(.04,.06,.10)),smoothstep(.0,.04,k)*(1.-sn)*.0);\n    col=mc;\n  }\n  if(qs.y<hn){\n    float k=hn-qs.y;\n    vec3 nc=L(vec3(.010,.018,.034))+ag*.03;\n    nc+=L(vec3(.3,.45,.6))*.1*smoothstep(.01,.0,k)*(.2+ag.g);\n    col=nc;\n  }\n  float tx=min(qs.x,asp-qs.x),cell=floor(qs.x*30.),tri=abs(fract(qs.x*30.+h11(cell)*.4)-.5)*2.;\n  float th=hz-.004+(.03+.2*smoothstep(.5,.0,tx))*(1.-tri*.6)*(.55+.45*h11(cell+3.));\n  if(tx<.5&&qs.y<th)col=L(vec3(.004,.007,.014))+ag*.008;\n  if(lake>.5){float d=hz-q.y;col*=mix(.55,.22,clamp(d*3.,0.,1.));col+=L(vec3(.03,.07,.1))*.35*exp(-d*26.)+L(vec3(.01,.02,.035))*.8;}\n  if(F>.5){for(int i=0;i<3;i++){float fi=float(i),sc=22.+fi*18.;vec2 g=q*sc+vec2(sin(T*.3+fi)*.6+W*T*.008,T*(.5+fi*.25)*.6);vec2 id=floor(g),f=fract(g)-.5;float r=h21(id+fi*9.);float d=length(f-(h22(id)-.5)*.5);col+=vec3(.8,.9,1.)*smoothstep(.07,.0,d)*step(.84,r)*(.45-fi*.1)*(q.y>hz?1.:.0);}}\n  gl_FragColor=vec4(fin(col*1.1,gl_FragCoord.xy),1.);\n}\n", "forest": "const float HZ=.40;\nvec4 foliage(vec2 q,float sc,float seed,vec3 dk,vec3 br,float cut){\n  vec2 p=q*sc+vec2(sin(T*.5+q.y*3.+seed)*.06+seed*3.,cos(T*.4+q.x*2.+seed)*.04);\n  float n=fbm3(p+fbm3(p*1.7+seed)*1.3);\n  float sp=n2(p*11.)*.55+n2(p*27.)*.45;\n  float m=smoothstep(cut,cut+.12,n+(sp-.5)*.38);\n  float l=clamp(fbm3(p*2.2+7.)*1.5+(sp-.5)*.7+.15*sin(T*.5+n*9.),0.,1.);\n  vec3 c=mix(dk,br,l*l);c+=L(vec3(.50,.62,.05))*pow(l,4.)*.5;\n  return vec4(c,m);\n}\nvec3 trunkAt(vec2 q,float asp,float k,float side,vec3 col,vec3 fogC,float t,float sh){\n  float sc=mix(.07,1.5,t*t);\n  float r=h21(vec2(k,side+3.));\n  float cx=asp*.5+side*((.28+.95*r)*sc+.10*sc);\n  float baseY=HZ-.30*sc;\n  float hw=.030*sc*(.75+.5*h21(vec2(k*3.1,side)));\n  float dx=(q.x-cx-sin(q.y*2.+k)*.004*sc)/hw;\n  float m=smoothstep(1.06,.90,abs(dx))*smoothstep(baseY-.004,baseY+.004,q.y)*smoothstep(.0,.12,t)*smoothstep(1.,.88,t);\n  if(m<=0.)return col;\n  float bark=.55+.65*n2(vec2(dx*5.+k,q.y*55./(sc+.15)))+.25*n2(vec2(dx*14.,q.y*20.));\n  float lit=clamp(.5+dx*.45*side,0.,1.);\n  vec3 tc=mix(L(vec3(.05,.04,.03)),L(vec3(.42,.32,.19)),clamp(lit*bark*.9+sh*.25,0.,1.));\n  float moss=smoothstep(.45*sc+.04,.0,q.y-baseY)*(.5+.5*n2(vec2(dx*3.,q.y*30.)));\n  tc=mix(tc,L(vec3(.13,.36,.04))*(.5+bark*.6),moss*.8);\n  tc=mix(tc,fogC,clamp(.78*(1.-t)+.04,0.,1.));\n  return mix(col,tc,m);\n}\nvoid main(){\n  vec2 q=gl_FragCoord.xy/R.y;float asp=R.x/R.y;float I=.6+.4*P;\n  q.x+=sin(T*.13)*.02;\n  vec3 fogC=L(vec3(.56,.74,.44));\n  vec3 col=mix(fogC*1.1,L(vec3(.12,.32,.06)),smoothstep(.0,.45,q.y-HZ))*(.75+.5*fbm3(q*vec2(4.,2.)));\n  col=mix(col,L(vec3(1.,.95,.65))*1.3,exp(-pow(length((q-vec2(asp*.5,HZ+.03))*vec2(.9,1.6)),2.)*7.)*.55);\n  if(q.y<HZ){\n    float d=HZ-q.y,z=1./(d+.025);\n    vec2 gp=vec2((q.x-asp*.5)*z*.9,z*1.3+T*.35);\n    float path=smoothstep(.70,.42,abs(gp.x-.55*sin(gp.y*.25)));\n    vec3 earth=mix(L(vec3(.38,.27,.13)),L(vec3(.64,.50,.28)),fbm3(gp*3.))*(.8+.5*step(.78,n2(gp*16.)));\n    vec3 grass=mix(L(vec3(.07,.27,.03)),L(vec3(.34,.62,.10)),fbm3(gp*vec2(8.,11.)))*(.7+.6*n2(gp*vec2(40.,55.)));\n    vec3 g=mix(grass,earth,path);\n    float dap=smoothstep(.50,.72,fbm3(gp*1.8+vec2(T*.02,0.)));\n    g*=.34+1.25*dap;\n    col=mix(g,fogC,exp(-d*9.)*.9);\n  }\n  float s=fbm3(vec2((q.x-q.y*.55)*6.+T*.05,T*.03+3.));\n  float shaft=smoothstep(.40,.85,s)*smoothstep(.0,.3,q.y)*(.6+.4*q.y);\n  for(int k=0;k<5;k++){float t=fract(float(k)/9.+T*.011);col=trunkAt(q,asp,float(k),-1.,col,fogC,t,shaft);col=trunkAt(q,asp,float(k),1.,col,fogC,t,shaft);col=mix(col,fogC,.04);}\n  float edge=smoothstep(.1,.6,abs(q.x-asp*.5)/asp);\n  float top=q.y+.2*fbm3(q*3.);\n  vec4 f1=foliage(q,5.,1.,L(vec3(.015,.07,.015)),L(vec3(.20,.46,.06)),.40);col=mix(col,f1.rgb,f1.a*smoothstep(.60,.92,top+.30*edge));\n  vec4 f2=foliage(q,3.2,2.,L(vec3(.02,.09,.015)),L(vec3(.32,.60,.07)),.44);col=mix(col,f2.rgb,f2.a*smoothstep(.68,1.0,top+.34*edge));\n  for(int k=5;k<9;k++){float t=fract(float(k)/9.+T*.011);col=trunkAt(q,asp,float(k),-1.,col,fogC,t,shaft);col=trunkAt(q,asp,float(k),1.,col,fogC,t,shaft);}\n  vec4 f3=foliage(q,1.9,3.,L(vec3(.012,.055,.012)),L(vec3(.38,.66,.07)),.47);col=mix(col,f3.rgb,f3.a*smoothstep(.72,1.05,top+.55*edge)*.96);\n  col+=L(vec3(1.,.90,.5))*shaft*.45*I;\n  col+=L(vec3(1.,.88,.5))*exp(-length(q-vec2(asp*.12,1.08))*1.8)*.45*I;\n  float fg=smoothstep(.45,.0,q.y)*smoothstep(.40,.72,fbm3(q*vec2(3.2,2.4)+7.+T*.02))+smoothstep(.14,.0,min(q.x,asp-q.x))*smoothstep(.4,.7,fbm3(q*3.+2.+T*.03));\n  col=mix(col,L(vec3(.03,.13,.02))*(.7+.9*fbm3(q*6.)),clamp(fg,0.,1.)*.85);\n  if(F>.5){\n    for(int i=0;i<3;i++){float fi=float(i);float sc=14.+fi*13.;vec2 gg=q*sc+vec2(sin(T*.15+fi*2.)*1.5+T*.08*(fi+1.),cos(T*.12+fi)*.8-T*.04);vec2 id2=floor(gg),f=fract(gg)-.5;float r=h21(id2+fi*5.);\n      float dd=length(f-(h22(id2)-.5)*.6);float tw=.6+.4*sin(T*1.5+r*30.);\n      col+=L(vec3(1.,.95,.6))*smoothstep(.12,.0,dd)*step(.8,r)*tw*(.9-fi*.2)*(.3+shaft*2.);}\n  }\n  float l=dot(col,vec3(.299,.587,.114));col=mix(vec3(l),col,1.22);\n  gl_FragColor=vec4(fin(col,gl_FragCoord.xy),1.);\n}\n", "sunset": "void main(){\n  vec2 q=gl_FragCoord.xy/R.y;float asp=R.x/R.y;\n  float hz=.34;float sunY=hz+.012+.05*P;vec2 sp=vec2(asp*.66,sunY);\n  float y=q.y;\n  vec3 skyTop=L(vec3(.10,.14,.34)),skyMid=L(vec3(.62,.30,.42)),skyLow=L(vec3(1.,.55,.22));\n  float t=clamp((y-hz)/(1.-hz),0.,1.);\n  vec3 col=mix(skyLow,skyMid,smoothstep(.0,.30,t));col=mix(col,skyTop,smoothstep(.22,.95,t));\n  float ds=length((q-sp)*vec2(1.,1.4));\n  col+=L(vec3(1.,.62,.28))*exp(-ds*3.2)*1.0+L(vec3(1.,.8,.5))*exp(-ds*9.)*1.1+L(vec3(1.,.95,.8))*smoothstep(.034,.028,length(q-sp))*4.;\n  /* clouds */\n  for(int k=0;k<2;k++){\n    float fk=float(k);float sc=1.6+fk*1.3;\n    vec2 cp=vec2(q.x*sc+T*.004*(1.+fk),(y-hz)*sc*3.2+fk*5.);\n    vec2 wv=vec2(fbm3(cp*1.7)*.6);float d=fbm3(cp+wv);\n    float cov=smoothstep(.46,.74,d)*smoothstep(.0,.12,y-hz)*smoothstep(1.05,.5,y)*(.85-fk*.2)*smoothstep(.04,.14,ds);\n    float dl=fbm3(cp+vec2(-.07,-.05)+wv);\n    float lit=clamp((d-dl)*5.+.5,0.,1.)*exp(-ds*1.6);\n    vec3 cc=mix(L(vec3(.20,.12,.22)),L(vec3(1.,.55,.30)),lit);\n    cc+=L(vec3(1.,.8,.55))*pow(lit,3.)*.8;\n    col=mix(col,cc,cov);\n  }\n  /* sea */\n  if(y<hz){\n    float d=hz-y;float dp=1./(d+.015);\n    vec2 wp=vec2((q.x-sp.x)*dp*.6,dp*.9+T*.25);\n    float w1=n2(wp*vec2(1.,2.))*2.-1.,w2=n2(wp*vec2(3.,5.)+7.)*2.-1.;\n    float nrm=w1*.6+w2*.4;\n    float sk=hz+d*.9;\n    vec3 refl=mix(skyLow,skyMid,smoothstep(.0,.3,(sk-hz)/(1.-hz)))*.55;\n    vec3 sea=mix(L(vec3(.03,.06,.12)),refl,.55+nrm*.12);\n    float path=exp(-pow((q.x-sp.x)/(.02+d*.35+abs(nrm)*.02),2.));\n    float gl=pow(clamp(.5+.5*(w1*.6+w2*.7),0.,1.),6.)*path;\n    sea+=L(vec3(1.,.7,.35))*(path*.25+gl*2.2)*(1.-smoothstep(.0,.34,d)*.35);\n    sea=mix(sea,col*.9,exp(-d*60.)*.8);\n    col=sea;\n  }\n  float hh=exp(-abs(y-hz)*40.);col+=L(vec3(1.,.5,.25))*hh*.2;\n  if(F>.5){float b=smoothstep(.0,.02,.0);}\n  gl_FragColor=vec4(fin(col*1.05,gl_FragCoord.xy),1.);\n}\n", "photo": "uniform sampler2D tex;uniform vec2 IM;uniform float DIM;uniform float BLR;\nvec3 sm(vec2 uv){return texture2D(tex,clamp(uv,.001,.999)).rgb;}\nvoid main(){\n  vec2 fc=gl_FragCoord.xy/R;\n  if(IM.x<2.){gl_FragColor=vec4(mix(vec3(.07,.09,.12),vec3(.14,.17,.22),fc.y)+(h21(gl_FragCoord.xy)-.5)/200.,1.);return;}\n  float ra=R.x/R.y,ia=IM.x/IM.y;vec2 s=ra>ia?vec2(1.,ia/ra):vec2(ra/ia,1.);\n  float z=.93-.02*sin(T*.07);\n  vec2 uv=(fc-.5)*s*z+.5+vec2(sin(T*.05)*.012,cos(T*.04)*.008);\n  float w=smoothstep(.15,1.,fc.y)*(.4+.6*W/5.);\n  uv+=vec2(sin(fc.y*7.+T*.8+fbm3(fc*3.+T*.1)*3.)*.0024,cos(fc.x*6.+T*.65)*.0018)*w;\n  vec3 c=sm(uv);\n  if(BLR>.5){vec2 px=vec2(BLR)/R*.6;c=(c*2.+sm(uv+vec2(px.x,0.))+sm(uv-vec2(px.x,0.))+sm(uv+vec2(0.,px.y))+sm(uv-vec2(0.,px.y)))/6.;}\n  float sh=smoothstep(.45,.9,fbm3(vec2((fc.x-fc.y*.5)*6.+T*.04,T*.03)))*(.4+.6*fc.y)*.16;\n  c+=vec3(1.,.9,.62)*sh*(.25+dot(c,vec3(.33)));\n  if(F>.5){for(int i=0;i<2;i++){float fi=float(i);float sc=16.+fi*14.;vec2 g=vec2(fc.x*R.x/R.y,fc.y)*sc+vec2(sin(T*.15+fi*2.)*1.5+T*.06*(fi+1.),cos(T*.12+fi)*.8-T*.03);vec2 id=floor(g),f=fract(g)-.5;float r=h21(id+fi*5.);\n    float d=length(f-(h22(id)-.5)*.6);c+=vec3(1.,.95,.7)*smoothstep(.12,.0,d)*step(.82,r)*(.6+.4*sin(T*1.5+r*30.))*(.7-fi*.2);}}\n  gl_FragColor=vec4(c*(1.-DIM)+(h21(gl_FragCoord.xy+fract(T))-.5)/200.,1.);\n}\n"};
let glc=null;
function glInit(){
  const cv=$('#g'),gl=cv.getContext('webgl',{antialias:false,alpha:false,powerPreference:'low-power'});
  if(!gl)return null;
  const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  return {cv,gl,progs:{}};
}
function glProg(name){
  const {gl}=glc;
  if(glc.progs[name])return glc.progs[name];
  const sh=(t,src)=>{const o=gl.createShader(t);gl.shaderSource(o,src);gl.compileShader(o);if(!gl.getShaderParameter(o,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(o));return o};
  const pr=gl.createProgram();
  gl.attachShader(pr,sh(gl.VERTEX_SHADER,'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}'));
  gl.attachShader(pr,sh(gl.FRAGMENT_SHADER,GLS.common+GLS[name]));
  gl.linkProgram(pr);if(!gl.getProgramParameter(pr,gl.LINK_STATUS))throw new Error('link');
  const u=n=>gl.getUniformLocation(pr,n);
  return glc.progs[name]={pr,a:gl.getAttribLocation(pr,'a'),R:u('R'),T:u('T'),P:u('P'),W:u('W'),F:u('F'),tex:u('tex'),IM:u('IM'),DIM:u('DIM'),BLR:u('BLR')};
}
function glBuild(){
  const {cv,gl}=glc,k=Math.min(1,devicePixelRatio||1)*(ST.q==='high'?1:ST.q==='low'?.45:gscale);
  cv.width=Math.max(2,Math.round(innerWidth*k));cv.height=Math.max(2,Math.round(innerHeight*k));gl.viewport(0,0,cv.width,cv.height);
}
function glFrame(g,now){
  const {cv,gl}=glc;
  gl.useProgram(g.pr);gl.enableVertexAttribArray(g.a);gl.vertexAttribPointer(g.a,2,gl.FLOAT,false,0,0);
  gl.uniform2f(g.R,cv.width,cv.height);gl.uniform1f(g.T,rm?14:(now/1000)%7200);gl.uniform1f(g.P,clamp(p));gl.uniform1f(g.W,S.wind);gl.uniform1f(g.F,S.petals&&!rm?1:0);
}
const mkGL=name=>()=>{
  try{
    if(!glc)glc=glInit();if(!glc)return null;
    const g=glProg(name),{gl}=glc;
    return {gl:true,build:glBuild,draw(now){glFrame(g,now);gl.drawArrays(gl.TRIANGLE_STRIP,0,4)}};
  }catch(e){return null}
};

/* ---- scene: living photo (your own picture with wind, light and dust) ---- */

window.applyVideoBg = function(fileOrBlob) {
  const vid = document.getElementById('bg_video');
  if (!vid) return;
  if (vid._url) URL.revokeObjectURL(vid._url);
  vid._url = URL.createObjectURL(fileOrBlob);
  vid.src = vid._url;
  vid.hidden = false;
  vid.play().catch(()=>{});
  const g = document.getElementById('g');
  if (g) g.hidden = true;
  window.updateBgFilters();
};

window.stopVideoBg = function() {
  const vid = document.getElementById('bg_video');
  if (vid) {
    vid.pause();
    vid.hidden = true;
  }
};

window.updateBgFilters = function() {
  const vid = document.getElementById('bg_video');
  if (vid) {
    const dim = 1 - (ST.phDim || 25) / 100;
    const blr = (ST.phBlur || 0);
    vid.style.filter = `brightness(${dim}) blur(${blr}px)`;
  }
};

const mkPhoto=()=>{
  try{
    if(!glc)glc=glInit();if(!glc)return null;
    const g=glProg('photo'),{gl}=glc,tex=gl.createTexture();
    let iw=1,ih=1;
    const upload=src=>{gl.bindTexture(gl.TEXTURE_2D,tex);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,src);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      iw=src.width;ih=src.height};
    const shrink=bm=>{const m=Math.max(bm.width,bm.height),k=Math.min(1,2048/m),c=document.createElement('canvas');c.width=Math.round(bm.width*k);c.height=Math.round(bm.height*k);c.getContext('2d').drawImage(bm,0,0,c.width,c.height);return c};
    const idb=()=>new Promise((res,rej)=>{const r=indexedDB.open('sakura',1);r.onupgradeneeded=()=>r.result.createObjectStore('bg');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
    (async()=>{try{const db=await idb();const b=await new Promise(res=>{const r=db.transaction('bg').objectStore('bg').get('img');r.onsuccess=()=>res(r.result);r.onerror=()=>res(null)});if(b){ if(b.type && b.type.startsWith('video/')){ window.applyVideoBg(b); } else { upload(shrink(await createImageBitmap(b))); } }}catch(e){}})();
    return {
      gl:true,build:glBuild,
      async set(file){const bm=shrink(await createImageBitmap(file));upload(bm);try{const db=await idb();await new Promise((res,rej)=>{const t=db.transaction('bg','readwrite');t.objectStore('bg').put(file,'img');t.oncomplete=res;t.onerror=()=>rej(t.error)})}catch(e){}},
      draw(now){
        glFrame(g,now);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);gl.uniform1i(g.tex,0);
        gl.uniform2f(g.IM,iw,ih);gl.uniform1f(g.DIM,ST.phDim/100);gl.uniform1f(g.BLR,ST.phBlur);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      }
    };
  }catch(e){return null}
};

/* ---- scene manager ---- */
const MK={sakura:mkSakura,aurora:mkGL('aurora'),forest:mkGL('forest'),sunset:mkGL('sunset'),photo:mkPhoto},SCN={};let scene=null;
function setScene(id){
  if(id==='synth')id='sunset';if(id==='nether'||id==='ocean')id='forest';
  if(!MK[id])id='sakura';
  let sc=SCN[id]||(SCN[id]=MK[id]());
  if(!sc){id='sakura';sc=SCN[id]||(SCN[id]=MK[id]())}
  scene=sc;document.documentElement.dataset.scene=id;
  $('#g').hidden=!sc.gl;$('#c').hidden=!!sc.gl;
  if(id!=='photo'){ if(window.stopVideoBg)window.stopVideoBg(); } else { const vid=document.getElementById('bg_video'); if(vid&&vid.src){ vid.hidden=false; vid.play().catch(()=>{}); $('#g').hidden=true; if(window.updateBgFilters)window.updateBgFilters(); } } sc.build();ST.scene=id;$('#phs').hidden=id!=='photo';
}
let rt;addEventListener('resize',()=>{clearTimeout(rt);rt=setTimeout(()=>scene&&scene.build(),150)});

let lastD=0,dtAcc=0,dtN=0,gscale=.65;
const FPS={auto:30,high:60,low:24};
function frame(now){
  requestAnimationFrame(frame);
  const qk=ST.q||'auto',iv=1000/FPS[qk];
  if(skinTick)skinTick(now);
  if(now-lastD<iv-2)return;
  const dt=Math.min(now-lastD,100);lastD=now;
  if(mode==='intro')target=rm?1:Math.min(1,(now-t0)/10000);
  const e=mode==='intro'?(target<.5?2*target*target:1-Math.pow(-2*target+2,2)/2):target;
  p=rm?e:p+(e-p)*(1-Math.exp(-dt/220));
  if(scene)scene.draw(now);
  if(qk==='auto'&&scene&&scene.gl){dtAcc+=now-lastD+dt;dtN++;if(dtN>=45){const avg=dtAcc/dtN/2;dtAcc=dtN=0;if(avg>iv*1.5&&gscale>.37){gscale=Math.max(.36,gscale*.82);scene.build()}}}
}

/* ---- navigation ---- */
const nav=id=>$(`.n[data-p="${id}"]`).click();
$$('.n').forEach(b => b.onclick = () => {
  $$('.n').forEach(x => x.removeAttribute('aria-current'));
  b.setAttribute('aria-current', 'page');
  const p = b.dataset.p;
  const isModSub = ['mods', 'resourcepacks', 'shaders', 'addons', 'instances', 'modpacks'].includes(p);
  const targetSectionId = isModSub ? 'mods' : p;

  $$('section').forEach(s => s.hidden = s.id !== targetSectionId);

  if (p === 'skins' && typeof render === 'function') render();
  if (p === 'servers' && window.initServers) window.initServers();
  if (p === 'friends' && window.initFriends) window.initFriends();
  if (p === 'downloads' && window.initDownloads) window.initDownloads();

  if (isModSub && window.switchToModType) {
    window.switchToModType(p);
  }

  $('.panel').classList.toggle('wide', p === 'skins');
  $('.panel').classList.toggle('xl', isModSub || p === 'servers' || p === 'downloads' || p === 'friends' || p === 'logs');
});
//

/* ---- versions and loaders ---- */