const rc=$('#sk'),tc=document.createElement('canvas');tc.width=tc.height=64;const tx=tc.getContext('2d',{willReadFrequently:true});
const ax=$('#sx').getContext('2d');ax.imageSmoothingEnabled=false;
let render=()=>{},setSlim=()=>{},skinTick=null;
function createSkinGL(cv){
  const gl=cv.getContext('webgl',{antialias:true,alpha:true,premultipliedAlpha:true});
  if(!gl)return null;
  const I=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  const mul=(a,b)=>{const o=new Float32Array(16);for(let i=0;i<4;i++)for(let j=0;j<4;j++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+j]*b[i*4+k];o[i*4+j]=s}return o};
  const tr=(x,y,z)=>{const m=I();m[12]=x;m[13]=y;m[14]=z;return m};
  const rx=a=>{const c=Math.cos(a),s=Math.sin(a),m=I();m[5]=c;m[6]=s;m[9]=-s;m[10]=c;return m};
  const ry=a=>{const c=Math.cos(a),s=Math.sin(a),m=I();m[0]=c;m[2]=-s;m[8]=s;m[10]=c;return m};
  const rz=a=>{const c=Math.cos(a),s=Math.sin(a),m=I();m[0]=c;m[1]=s;m[4]=-s;m[5]=c;return m};
  const persp=(fov,asp,n,f)=>{const t=1/Math.tan(fov/2),m=new Float32Array(16);m[0]=t/asp;m[5]=t;m[10]=(f+n)/(n-f);m[11]=-1;m[14]=2*f*n/(n-f);return m};
  const look=(e,t)=>{let f=[t[0]-e[0],t[1]-e[1],t[2]-e[2]],l=Math.hypot(...f);f=f.map(v=>v/l);
    let r=[f[2]*0-f[1]*0,0,0];r=[f[1]*0-f[2]*1,f[2]*0-f[0]*0,f[0]*1-f[1]*0];r=[-f[2],0,f[0]];l=Math.hypot(...r);r=r.map(v=>v/l);
    const u=[r[1]*f[2]-r[2]*f[1],r[2]*f[0]-r[0]*f[2],r[0]*f[1]-r[1]*f[0]],m=I(),d=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
    m[0]=r[0];m[4]=r[1];m[8]=r[2];m[12]=-d(r,e);m[1]=u[0];m[5]=u[1];m[9]=u[2];m[13]=-d(u,e);m[2]=-f[0];m[6]=-f[1];m[10]=-f[2];m[14]=d(f,e);return m};
  const sh=(t,s)=>{const o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);if(!gl.getShaderParameter(o,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(o));return o};
  const pr=gl.createProgram();
  gl.attachShader(pr,sh(gl.VERTEX_SHADER,'attribute vec3 aP;attribute vec3 aN;attribute vec2 aU;uniform mat4 uMVP;uniform mat4 uM;varying vec3 vN;varying vec2 vU;varying vec3 vW;void main(){vN=mat3(uM[0].xyz,uM[1].xyz,uM[2].xyz)*aN;vU=aU;vW=(uM*vec4(aP,1.)).xyz;gl_Position=uMVP*vec4(aP,1.);}'));
  gl.attachShader(pr,sh(gl.FRAGMENT_SHADER,`precision mediump float;uniform sampler2D uT;uniform float uMode;varying vec3 vN;varying vec2 vU;varying vec3 vW;
  void main(){
    if(uMode>.5){float d=length(vW.xz/vec2(12.,9.));gl_FragColor=vec4(0.,0.,0.,.42*smoothstep(1.,.0,d));return;}
    vec4 t=texture2D(uT,vU);if(t.a<.85)discard;
    vec3 n=normalize(vN);
    float diff=max(dot(n,normalize(vec3(-.45,.8,.6))),0.);
    float fs=n.y>.5?1.:(n.y<-.5?.52:(abs(n.x)>.5?.80:.92));
    float light=.52+.46*diff+.16*(.5+.5*n.y);
    float rim=pow(1.-max(dot(n,normalize(vec3(.25,.15,1.))),0.),3.)*.07;
    vec3 c=t.rgb*light*fs*1.12+rim*vec3(1.,.9,.95);
    c*=mix(.80,1.,smoothstep(0.,9.,vW.y));
    gl_FragColor=vec4(c,1.);
  }`));
  gl.linkProgram(pr);if(!gl.getProgramParameter(pr,gl.LINK_STATUS))throw new Error('link');
  gl.useProgram(pr);
  const aP=gl.getAttribLocation(pr,'aP'),aN=gl.getAttribLocation(pr,'aN'),aU=gl.getAttribLocation(pr,'aU'),uMVP=gl.getUniformLocation(pr,'uMVP'),uM=gl.getUniformLocation(pr,'uM'),uMode=gl.getUniformLocation(pr,'uMode'),uT=gl.getUniformLocation(pr,'uT');
  const box=(w,h,d,u,v,g)=>{
    const hw=(w+g)/2,hh=(h+g)/2,hd=(d+g)/2;
    const F=[[[0,0,1],[[-hw,hh,hd],[hw,hh,hd],[hw,-hh,hd],[-hw,-hh,hd]],[u+d,v+d,w,h]],
      [[0,0,-1],[[hw,hh,-hd],[-hw,hh,-hd],[-hw,-hh,-hd],[hw,-hh,-hd]],[u+2*d+w,v+d,w,h]],
      [[1,0,0],[[hw,hh,hd],[hw,hh,-hd],[hw,-hh,-hd],[hw,-hh,hd]],[u+d+w,v+d,d,h]],
      [[-1,0,0],[[-hw,hh,-hd],[-hw,hh,hd],[-hw,-hh,hd],[-hw,-hh,-hd]],[u,v+d,d,h]],
      [[0,1,0],[[-hw,hh,-hd],[hw,hh,-hd],[hw,hh,hd],[-hw,hh,hd]],[u+d,v,w,d]],
      [[0,-1,0],[[-hw,-hh,hd],[hw,-hh,hd],[hw,-hh,-hd],[-hw,-hh,-hd]],[u+d+w,v,w,d]]];
    const vd=[],ix=[];
    F.forEach((f,i)=>{const [n,c,r]=f,x0=r[0]/64,y0=r[1]/64,x1=(r[0]+r[2])/64,y1=(r[1]+r[3])/64,uv=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
      for(let k=0;k<4;k++)vd.push(c[k][0],c[k][1],c[k][2],n[0],n[1],n[2],uv[k][0],uv[k][1]);
      const b=i*4;ix.push(b,b+3,b+2,b,b+2,b+1)});
    const vb=gl.createBuffer(),ib=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,vb);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vd),gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(ix),gl.STATIC_DRAW);
    return {vb,ib,n:ix.length};
  };
  const quad=(()=>{const vb=gl.createBuffer(),ib=gl.createBuffer(),s=14;
    gl.bindBuffer(gl.ARRAY_BUFFER,vb);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-s,0,-s,0,1,0,0,0,s,0,-s,0,1,0,0,0,s,0,s,0,1,0,0,0,-s,0,s,0,1,0,0,0]),gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array([0,2,1,0,3,2]),gl.STATIC_DRAW);return {vb,ib,n:6}})();
  /* body parts: m = mesh, p = pivot, o = offset of the mesh from the pivot, j = joint, ov = outer layer, sl = slim only, wd = wide only */
  const P=[];
  const add=(m,p,o,j,ov,sl)=>P.push({m,p,o,j,ov,sl});
  add(box(8,8,8,0,0,0),[0,24,0],[0,4,0],'head');add(box(8,8,8,32,0,1),[0,24,0],[0,4,0],'head',1);
  add(box(8,12,4,16,16,0),[0,18,0],[0,0,0],'body');add(box(8,12,4,16,32,.5),[0,18,0],[0,0,0],'body',1);
  add(box(4,12,4,40,16,0),[-6,24,0],[0,-6,0],'ra',0,'w');add(box(4,12,4,40,32,.5),[-6,24,0],[0,-6,0],'ra',1,'w');
  add(box(3,12,4,40,16,0),[-5.5,24,0],[0,-6,0],'ra',0,'s');add(box(3,12,4,40,32,.5),[-5.5,24,0],[0,-6,0],'ra',1,'s');
  add(box(4,12,4,32,48,0),[6,24,0],[0,-6,0],'la',0,'w');add(box(4,12,4,48,48,.5),[6,24,0],[0,-6,0],'la',1,'w');
  add(box(3,12,4,32,48,0),[5.5,24,0],[0,-6,0],'la',0,'s');add(box(3,12,4,48,48,.5),[5.5,24,0],[0,-6,0],'la',1,'s');
  add(box(4,12,4,0,16,0),[-2,12,0],[0,-6,0],'rl');add(box(4,12,4,0,32,.5),[-2,12,0],[0,-6,0],'rl',1);
  add(box(4,12,4,16,48,0),[2,12,0],[0,-6,0],'ll');add(box(4,12,4,0,48,.5),[2,12,0],[0,-6,0],'ll',1);
  const tex=gl.createTexture();
  const S={slim:false,outer:true,yaw:.55,pitch:0,dist:94,w:{head:[.18,0],ra:[0,-.05],la:[0,.05],rl:[0,0],ll:[0,0],body:[0,0]},fig:{y:0,yaw:0,lean:0}};
  gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);gl.frontFace(gl.CCW);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
  const bind=m=>{gl.bindBuffer(gl.ARRAY_BUFFER,m.vb);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,m.ib);
    gl.enableVertexAttribArray(aP);gl.vertexAttribPointer(aP,3,gl.FLOAT,false,32,0);gl.enableVertexAttribArray(aN);gl.vertexAttribPointer(aN,3,gl.FLOAT,false,32,12);gl.enableVertexAttribArray(aU);gl.vertexAttribPointer(aU,2,gl.FLOAT,false,32,24)};
  return {
    S,
    texture(src){gl.bindTexture(gl.TEXTURE_2D,tex);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,src);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE)},
    draw(){
      const pxr=Math.min(devicePixelRatio||1,2),W=Math.round(cv.clientWidth*pxr)||cv.width,H=Math.round(cv.clientHeight*pxr)||cv.height;
      if(cv.width!==W||cv.height!==H){cv.width=W;cv.height=H}
      gl.viewport(0,0,cv.width,cv.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      const proj=persp(26*Math.PI/180,cv.width/cv.height,1,400),view=look([0,21,S.dist],[0,15.5,0]);
      const root=mul(rx(S.pitch),ry(S.yaw)),f=S.fig;
      const fig=mul(root,mul(tr(0,f.y,0),mul(ry(f.yaw),rx(f.lean))));
      gl.uniform1i(uT,0);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);
      const vp=mul(proj,view);
      for(const q of P){
        if(q.ov&&!S.outer)continue;if(q.sl==='s'&&!S.slim)continue;if(q.sl==='w'&&S.slim)continue;
        const jt=S.w[q.j]||[0,0];
        let m=mul(fig,tr(q.p[0],q.p[1],q.p[2]));
        if(q.j==='head')m=mul(m,mul(ry(jt[0]),rx(jt[1])));else if(q.j==='ra'||q.j==='la')m=mul(m,mul(rz(jt[1]),rx(jt[0])));else if(q.j==='rl'||q.j==='ll')m=mul(m,rx(jt[0]));
        m=mul(m,tr(q.o[0],q.o[1],q.o[2]));
        gl.uniform1f(uMode,0);gl.uniformMatrix4fv(uM,false,m);gl.uniformMatrix4fv(uMVP,false,mul(vp,m));bind(q.m);gl.drawElements(gl.TRIANGLES,q.m.n,gl.UNSIGNED_SHORT,0);
      }
      gl.depthMask(false);const sm=mul(root,tr(0,.02,0));gl.uniform1f(uMode,1);gl.uniformMatrix4fv(uM,false,sm);gl.uniformMatrix4fv(uMVP,false,mul(vp,sm));bind(quad);gl.drawElements(gl.TRIANGLES,6,gl.UNSIGNED_SHORT,0);gl.depthMask(true);
    }
  };
}

let skinG=null;
try{
  skinG=createSkinGL(rc);if(!skinG)throw new Error('gl');
  const S3=skinG.S;let posem='idle',dirty=true,texDirty=true,drag=null,spin=false,atlas=false;
  setSlim=sl=>{S3.slim=sl;dirty=true};
  const pose=t=>{
    const W=S3.w,F=S3.fig;
    if(posem==='idle'){
      const b=Math.sin(t*1.4);W.rl=[.04,0];W.ll=[-.04,0];W.ra=[.06+b*.03,-.05-b*.01];W.la=[-.06-b*.03,.05+b*.01];
      W.head=[.18+Math.sin(t*.6)*.07,Math.sin(t*.8)*.025];F.y=0;F.yaw=0;F.lean=0;
    }else{
      const run=posem==='run',w=Math.sin(t*(run?7:4.2)),A=run?1:.6,Lg=run?1:.7;
      W.rl=[w*Lg,0];W.ll=[-w*Lg,0];W.ra=[-w*A,-.05];W.la=[w*A,.05];W.head=[.18-w*.1,run?-.18:0];
      F.y=Math.abs(w)*(run?.8:.4);F.yaw=w*.08;F.lean=run?.18:0;
    }
  };
  const sec=$('#skins');
  render=()=>{texDirty=true;dirty=true;ax.clearRect(0,0,64,64);ax.drawImage(tc,0,0)};
  skinTick=now=>{
    if(sec.hidden||atlas)return;
    if(rm){if(!dirty)return;pose(0)}else{pose(now/1000);if(spin&&drag==null)S3.yaw+=.01}
    dirty=false;if(texDirty){skinG.texture(tc);texDirty=false}
    skinG.draw();
  };
  const chips=(box2,on)=>$$(box2+' .chip').forEach(c=>c.setAttribute('aria-pressed',c===on));
  $('#pz').onclick=e=>{const b=e.target.closest('[data-z]');if(!b)return;posem=b.dataset.z;chips('#pz',b);dirty=true};
  $('#vz').onclick=e=>{const b=e.target.closest('[data-v]');if(!b)return;atlas=b.dataset.v==='2d';chips('#vz',b);rc.hidden=atlas;$('#sx').hidden=!atlas;dirty=true};
  $('#lay').onchange=e=>{S3.outer=e.target.checked;dirty=true};
  $('#spin').onchange=e=>{spin=e.target.checked};
  rc.onpointerdown=e=>{drag=[e.clientX,e.clientY];rc.setPointerCapture(e.pointerId)};
  rc.onpointermove=e=>{if(!drag)return;S3.yaw+=(e.clientX-drag[0])*.012;S3.pitch=clamp(S3.pitch+(e.clientY-drag[1])*.006,-.4,.4);drag=[e.clientX,e.clientY];dirty=true};
  rc.onpointerup=rc.onpointercancel=()=>drag=null;
  rc.addEventListener('wheel',e=>{e.preventDefault();S3.dist=clamp(S3.dist+e.deltaY*.06,60,150);dirty=true},{passive:false});
  rc.onkeydown=e=>{const k=e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0;if(k){S3.yaw+=k*.2;dirty=true;e.preventDefault()}};
}catch(err){$('#sd').textContent='3D недоступен в этом браузере.'}
function hs(s){let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0}
const dk=(c,k)=>'#'+[1,3,5].map(i=>Math.round(parseInt(c.substr(i,2),16)*k).toString(16).padStart(2,'0')).join('');
function paint(name){
  const h=hs(name.toLowerCase()),r=rng(h),skin=['#f1c9a5','#e0ac85','#c68a62','#8d5a3b'][h%4];
  const hair=['#4a2f22','#2b2118','#8a5a2b','#c9a24a','#7a2e2e','#222831','#2f6b55','#3d3a40'][(h>>3)%8],hd2=dk(hair,.7);
  const shirt=['#1b1b20','#2c3e50','#7a2e3b','#2f6b4f','#5b4a9a','#c58b2a','#3b6fb5'][(h>>6)%7];
  const pants=['#22262e','#33405a','#3e3a35'][(h>>9)%3],dark='#14141a',ac=['#8fd3ff','#ff8fb1','#ffd666'][(h>>12)%3];
  const F=(x,y,w,hh,c)=>{tx.fillStyle=c;tx.fillRect(x,y,w,hh)};
  const B=(u,v,w,hh,d,c,t,b)=>{F(u,v+d,2*(d+w),hh,c);F(u+d,v,w,d,t||c);F(u+d+w,v,w,d,b||c)};
  const spr=(x,y,w,hh,c,pr)=>{for(let i=0;i<w;i++)for(let j=0;j<hh;j++)if(r()<pr)F(x+i,y+j,1,1,c)};
  const plaid=(x,y,w,hh)=>{for(let i=0;i<w;i++)for(let j=0;j<hh;j++)if(((i>>1)+(j>>1))&1)F(x+i,y+j,1,1,dk(pants,.55))};
  tx.clearRect(0,0,64,64);
  B(0,0,8,8,8,skin,hair,skin);F(0,8,32,3,hair);F(24,8,8,8,hair);F(0,8,8,4,hair);F(16,8,8,4,hair);
  F(9,12,1,1,'#fff');F(14,12,1,1,'#fff');F(10,12,1,1,'#2b3a67');F(13,12,1,1,'#2b3a67');F(11,14,2,1,'#a0583a');F(11,13,2,1,dk(skin,.88));
  if(h&1){F(9,11,6,1,dark);F(9,13,6,1,dark);F(9,12,1,1,dark);F(14,12,1,1,dark);F(11,12,2,1,dark)}else{F(9,11,2,1,hd2);F(13,11,2,1,hd2)}
  F(40,0,8,8,hair);F(32,8,32,2,hair);F(56,8,8,8,hair);F(32,8,8,5,hair);F(48,8,8,5,hair);
  spr(0,8,32,3,hd2,.35);spr(40,0,8,8,hd2,.35);spr(32,8,32,2,hd2,.35);spr(56,8,8,8,hd2,.3);
  B(16,16,8,12,4,shirt);F(20,20,8,1,dk(shirt,.78));F(23,21,1,4,'#cfcfd6');F(24,21,1,4,'#cfcfd6');F(22,24,4,4,ac);F(21,43,6,3,dk(shirt,.7));
  B(40,16,4,12,4,shirt,shirt,skin);F(40,28,16,1,dk(shirt,.75));F(40,29,16,3,skin);
  B(32,48,4,12,4,shirt,shirt,skin);F(32,60,16,1,dk(shirt,.75));F(32,61,16,3,skin);
  B(0,16,4,12,4,pants);B(16,48,4,12,4,pants);
  if((h>>15)&1){plaid(0,20,16,10);plaid(16,52,16,10)}
  F(0,30,16,2,dark);F(16,62,16,2,dark);
  const id=tx.getImageData(0,0,64,64),d=id.data,r2=rng(h^77);
  for(let i=0;i<d.length;i+=4)if(d[i+3]){const k=.93+r2()*.12;d[i]*=k;d[i+1]*=k;d[i+2]*=k}
  tx.putImageData(id,0,0);setSlim(false);render();
}

/* старые скины 64x32 переводим в 64x64 */
function norm(im){
  const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');x.drawImage(im,0,0);
  if(im.naturalHeight===32){
    const src=document.createElement('canvas');src.width=src.height=64;src.getContext('2d').drawImage(c,0,0);
    const fl=(sx,sy,w,h,dx,dy)=>{x.save();x.translate(dx+w,dy);x.scale(-1,1);x.drawImage(src,sx,sy,w,h,0,0,w,h);x.restore()};
    const limb=(sx,sy,dx,dy)=>{fl(sx+4,sy,4,4,dx+4,dy);fl(sx+8,sy,4,4,dx+8,dy);fl(sx,sy+4,4,12,dx+8,dy+4);fl(sx+4,sy+4,4,12,dx+4,dy+4);fl(sx+8,sy+4,4,12,dx,dy+4);fl(sx+12,sy+4,4,12,dx+12,dy+4)};
    limb(0,16,16,48);limb(40,16,32,48);
  }
  return c;
}
function useImage(im,label,note){
  if(im.naturalWidth!==64||![32,64].includes(im.naturalHeight)){toast('Нужен PNG размером 64×64 (или старый 64×32)');return false}
  tx.clearRect(0,0,64,64);tx.drawImage(norm(im),0,0);
  const sl=tx.getImageData(54,20,1,1).data[3]===0;setSlim(sl);render();
  $('#sn').textContent=label;$('#sd').textContent=note+(sl?' Модель: тонкие руки.':' Модель: обычные руки.');return true;
}
$('#upb').onclick=()=>$('#up').click();
$('#up').onchange=e=>{
  const f=e.target.files[0];if(!f)return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    const im = new Image();
    im.onload = () => {
      const name = f.name.replace(/\.png$/i, '').slice(0, 24);
      if (useImage(im, name, 'Загружено с компьютера.')) {
        ST.skinData = dataUrl;
        ST.skinName = name;
        ST.skinSlim = tx.getImageData(54, 20, 1, 1).data[3] === 0;
        save();
        $('#ss').textContent = 'Скин успешно сохранён!';
        toast('Скин сохранён!');
      }
    };
    im.onerror = () => toast('Не удалось открыть файл');
    im.src = dataUrl;
  };
  reader.readAsDataURL(f);
  e.target.value = '';



};
$('#dlp').onclick=()=>tc.toBlob(b=>b&&saveBlob(b,($('#sn').textContent||'skin')+'.png'));

paint('Steve');$('#sd').textContent='Стандартный скин (схематичный). Модель: обычные руки.';
window.initSkin = async function() {
  if (ST.skinData) {
    const im = new Image();
    im.onload = () => { useImage(im, ST.skinName || 'Мой скин', 'Сохранённый скин.'); };
    im.src = ST.skinData;
  
  }
  const acc = window.ST_ACCOUNTS ? window.ST_ACCOUNTS.find(a => a.id === window.ST_ACTIVE_ACC) : null;
  if (acc && acc.type === 'elyby' && window.autoLoadSkin) {
    await window.autoLoadSkin();
  }
};
setTimeout(() => { if (window.initSkin) window.initSkin(); }, 150);

/* ---- friends and account ---- */