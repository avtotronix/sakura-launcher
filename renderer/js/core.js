const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let rm=false;
function rng(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
let tt;function toast(m){const e=$('#t');e.textContent=m;e.classList.add('s');clearTimeout(tt);tt=setTimeout(()=>e.classList.remove('s'),3600)}
const S={petals:true,wind:5},clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
let p=0,target=0,mode='intro',t0=performance.now(),bg=null;

const LD=['Fabric','Forge','NeoForge'];
const VL=["26.3","26.2","26.1.2","26.1.1","26.1","1.21.11","1.21.10","1.21.9","1.21.8","1.21.7","1.21.6","1.21.5","1.21.4","1.21.3","1.21.2","1.21.1","1.21","1.20.6","1.20.5","1.20.4","1.20.3","1.20.2","1.20.1","1.20","1.19.4","1.19.3","1.19.2","1.19.1","1.19","1.18.2","1.18.1","1.18","1.17.1","1.17","1.16.5","1.16.4","1.16.3","1.16.2","1.16.1","1.16","1.15.2","1.15.1","1.15","1.14.4","1.14.3","1.14.2","1.14.1","1.14","1.13.2","1.13.1","1.13","1.12.2","1.12.1","1.12","1.11.2","1.11.1","1.11","1.10.2","1.10.1","1.10","1.9.4","1.9.3","1.9.2","1.9.1","1.9","1.8.9","1.8.8","1.8.7","1.8.6","1.8.5","1.8.4","1.8.3","1.8.2","1.8.1","1.8","1.7.10","1.7.9","1.7.8","1.7.7","1.7.6","1.7.5","1.7.4","1.7.3","1.7.2","1.6.4","1.6.2","1.6.1","1.5.2","1.5.1","1.4.7","1.4.6","1.4.5","1.4.4","1.4.2","1.3.2","1.3.1","1.2.5","1.2.4","1.2.3","1.2.2","1.2.1","1.1","1.0"];
let VR=[...VL];

/* ---- state: saved on this device and, when the viewer is signed in, in the account ---- */
const LS='sakura.state';
const ST={scene:'',nick:'',ram:4,java:0,dir:'%APPDATA%\\.sakura',cl:false,petals:true,wind:5,ely:'',g:0,m:0,fr:[],inc:['NightPetal'],mods:[],phDim:25,phBlur:0,q:'auto',anim:true,packs:[],cfKey:'',installed:[],lastVersion:'',lastPack:'',skinData:'',skinName:'',skinSlim:false,elyAuth:false};
try{Object.assign(ST,JSON.parse(localStorage.getItem(LS)||'{}'))}catch(e){}
S.petals=ST.petals;S.wind=ST.wind;rm=ST.anim===false;
let DB=null,UID=null,saveT;
function save(){clearTimeout(saveT);saveT=setTimeout(async()=>{try{localStorage.setItem(LS,JSON.stringify(ST))}catch(e){}if(window.sakura&&window.sakura.writeState){try{await window.sakura.writeState({[LS]:JSON.stringify(ST)});}catch(e){}}if(DB&&UID){try{await DB.doc(`data/users/${UID}/profile`).set(ST)}catch(e){}}},300)}

/* ---- scene: sakura ---- */
const mkSakura=()=>{
  const cv=$('#c'),cx=cv.getContext('2d'),Z=[0,1,2],hasF='filter' in cx;
  let W,H,dpr,layers=[],fl=[[],[],[]];
  const mk=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};
  const blur=(src,px)=>{if(!hasF||!px)return src;const c=mk(src.width,src.height),x=c.getContext('2d');x.filter=`blur(${px}px)`;x.drawImage(src,0,0);return c};
  function flowerSprite(sz,rot,deep,soft){
    const c=mk(sz,sz),x=c.getContext('2d'),r=sz*.47;
    x.translate(sz/2,sz/2);x.rotate(rot);
    for(let i=0;i<5;i++){
      x.save();x.rotate(i*Math.PI*2/5);
      const g=x.createRadialGradient(0,-r*.2,r*.03,0,-r*.55,r*.7);
      g.addColorStop(0,deep?'#f3a2bd':'#fff4f7');g.addColorStop(.6,deep?'#f6b6cb':'#fbd3e0');g.addColorStop(1,deep?'#f9cddb':'#f8c1d3');
      x.fillStyle=g;x.beginPath();x.moveTo(0,0);
      x.bezierCurveTo(-r*.62,-r*.2,-r*.55,-r*.95,-r*.12,-r);x.lineTo(0,-r*.86);x.lineTo(r*.12,-r);
      x.bezierCurveTo(r*.55,-r*.95,r*.62,-r*.2,0,0);x.fill();
      x.strokeStyle='rgba(214,110,145,.35)';x.lineWidth=Math.max(.6,sz/90);x.stroke();
      x.restore();
    }
    const gc=x.createRadialGradient(0,0,0,0,0,r*.4);gc.addColorStop(0,'rgba(222,86,128,.75)');gc.addColorStop(1,'rgba(222,86,128,0)');
    x.fillStyle=gc;x.beginPath();x.arc(0,0,r*.4,0,7);x.fill();
    x.strokeStyle='#c24470';x.lineWidth=Math.max(.7,sz/70);
    for(let i=0;i<9;i++){const a=i*.7+.3,l=r*(.28+((i*37)%10)/60);x.beginPath();x.moveTo(0,0);x.lineTo(Math.cos(a)*l,Math.sin(a)*l);x.stroke();x.fillStyle='#e8a0b8';x.fillRect(Math.cos(a)*l-.8,Math.sin(a)*l-.8,1.6,1.6)}
    return soft?blur(c,soft):c;
  }
  const spr=Z.map(z=>Array.from({length:6},(_,i)=>flowerSprite([56,72,96][z],i*.9,i%2,[3.5,1.4,0][z])));
  const leaf=(()=>{const c=mk(40,40),x=c.getContext('2d');x.translate(20,20);x.rotate(-.6);const g=x.createLinearGradient(-14,0,14,0);g.addColorStop(0,'#86b45e');g.addColorStop(1,'#5f9144');x.fillStyle=g;x.beginPath();x.ellipse(0,0,15,6.5,0,0,7);x.fill();x.strokeStyle='rgba(255,255,255,.25)';x.beginPath();x.moveTo(-14,0);x.lineTo(14,0);x.stroke();return c})();
  const pet=(()=>{const c=mk(32,32),x=c.getContext('2d');x.translate(16,16);const g=x.createRadialGradient(-3,-3,1,0,0,13);g.addColorStop(0,'#fff0f5');g.addColorStop(1,'#f5b0c8');x.fillStyle=g;x.beginPath();x.moveTo(0,-13);x.bezierCurveTo(12,-10,11,10,0,13);x.bezierCurveTo(-11,10,-12,-10,0,-13);x.fill();return c})();
  let petals=[],scale=1;
  function build(){
    dpr=Math.min(devicePixelRatio||1,1.25);W=innerWidth;H=innerHeight;cv.width=W*dpr;cv.height=H*dpr;
    const s=scale=clamp(Math.min(W,H)/800,.6,1.5),r=rng(21),nd=[[],[],[]],wk=[4,7.5,11].map(v=>v*s),ink=['rgba(120,86,74,.5)','rgba(88,60,50,.8)','#4a3228'];
    layers=Z.map(()=>{const c=mk(W*dpr,H*dpr);c.getContext('2d').scale(dpr,dpr);return c});
    fl=[[],[],[]];petals=[];let segs=0;
    function grow(z,x,y,a,len,w,d){
      if(w<.45*s||d>6||++segs>2800)return;
      const x0=layers[z].getContext('2d'),n=Math.max(2,Math.round(len/(24*s)));
      let px=x,py=y;x0.strokeStyle=ink[z];x0.lineCap='round';
      for(let i=0;i<n;i++){
        a+=(r()-.5)*.4;const st=len/n,nx=px+Math.cos(a)*st,ny=py+Math.sin(a)*st;
        x0.lineWidth=w*(1-i/n*.35);x0.beginPath();x0.moveTo(px,py);x0.lineTo(nx,ny);x0.stroke();
        if(d>=1&&r()<.75)nd[z].push([nx,ny]);
        px=nx;py=ny;
        if(r()<.15&&d<6)grow(z,px,py,a+(r()<.5?-1:1)*(.45+r()*.5),len*.6,w*.6,d+1);
      }
      grow(z,px,py,a+(r()-.5)*.5,len*.72,w*.7,d+1);
    }
    const roots=[];
    [.12,.38,.62,.88].forEach((f,i)=>roots.push([W+30,H*f,Math.PI+(r()-.5)*.6,[2,1,2,0][i]]));
    [.3,.55,.78,.95].forEach((f,i)=>roots.push([W*f,-30,Math.PI/2+(r()-.5)*.6,[1,2,0,2][i]]));
    [.2,.7].forEach((f,i)=>roots.push([-30,H*f,(r()-.5)*.5,[0,1][i]]));
    [.55,.85].forEach((f,i)=>roots.push([W*f,H+30,-Math.PI/2+(r()-.5)*.5,[1,2][i]]));
    roots.forEach(q=>grow(q[3],q[0],q[1],q[2],(480+r()*160)*s,wk[q[3]]*(.8+r()*.4),0));
    layers=layers.map((c,z)=>blur(c,[2.5,1,0][z]));
    const cap=[300,380,300],rs=[[18,32],[30,46],[46,74]];
    Z.forEach(z=>{
      const a=nd[z];for(let i=a.length;i--;){const j=(r()*(i+1))|0;[a[i],a[j]]=[a[j],a[i]]}
      a.slice(0,Math.ceil(cap[z]/3)).forEach(n=>{
        for(let k=0;k<3;k++)fl[z].push({x:n[0]+(r()-.5)*rs[z][1]*s*1.1,y:n[1]+(r()-.5)*rs[z][1]*s*1.1,sz:(rs[z][0]+r()*(rs[z][1]-rs[z][0]))*s,v:(r()*6)|0,t:r()*.85,ph:r()*6});
        if(r()<.25)fl[z].push({x:n[0]+(r()-.5)*40*s,y:n[1]+(r()-.5)*40*s,sz:(16+r()*14)*s*(1+z*.4),l:1,t:.35+r()*.5,ph:r()*6});
      });
    });
    for(let i=0;i<100;i++)fl[0].push({x:r()*W,y:r()*H,sz:(24+r()*40)*s,v:(r()*6)|0,t:r()*.85,ph:r()*6});
    for(let i=0;i<60;i++)fl[1].push({x:r()*W,y:r()*H,sz:(26+r()*30)*s,v:(r()*6)|0,t:r()*.85,ph:r()*6});
  }
  return {
    build,
    draw(now){
      const k=rm?0:now/1000,wm=S.wind/5+.4;
      cx.setTransform(dpr,0,0,dpr,0,0);cx.clearRect(0,0,W,H);
      for(const z of Z){
        const ox=Math.sin(k*.5+z)*(2+z*3.5)*wm,oy=Math.cos(k*.4+z*2)*(1.2+z*2)*wm;
        cx.drawImage(layers[z],ox,oy,W,H);
        for(const f of fl[z]){
          const g=clamp((p-f.t)/.14);if(g<=0)continue;
          const sz=f.sz*g,sw=rm?0:Math.sin(k*.9+f.ph)*(1+z)*.8*wm,x=f.x+ox+sw,y=f.y+oy;
          if(f.l)cx.drawImage(leaf,x-sz/2,y-sz/2,sz,sz);
          else cx.drawImage(spr[z][f.v],x-sz/2,y-sz/2,sz,sz);
        }
      }
      if(!S.petals||rm)petals.length=0;
      else if(p>.75&&petals.length<45&&Math.random()<.2){
        const f=fl[1+((Math.random()*2)|0)][0|Math.random()*40];
        if(f&&!f.l)petals.push({x:f.x,y:f.y,vy:.7+Math.random()*1.1,ph:Math.random()*6,sz:(9+Math.random()*13)*scale,a:Math.random()*6,va:(Math.random()-.5)*.07});
      }
      for(let i=petals.length;i--;){
        const q=petals[i];q.ph+=.03;q.x+=Math.sin(q.ph)*.7-S.wind*.22;q.y+=q.vy*(q.sz/14);q.a+=q.va;
        if(q.y>H+30||q.x<-40){petals.splice(i,1);continue}
        cx.save();cx.translate(q.x,q.y);cx.rotate(q.a);cx.globalAlpha=.9;cx.drawImage(pet,-q.sz/2,-q.sz/2,q.sz,q.sz);cx.restore();
      }
      cx.globalAlpha=1;cx.globalCompositeOperation='screen';
      const lg=cx.createRadialGradient(W*.86,-H*.08,0,W*.86,-H*.08,H*1.1);lg.addColorStop(0,'rgba(255,246,225,.62)');lg.addColorStop(.5,'rgba(255,240,220,.18)');lg.addColorStop(1,'rgba(255,240,220,0)');
      cx.fillStyle=lg;cx.fillRect(0,0,W,H);cx.globalCompositeOperation='source-over';
    }
  };
};

/* ---- scenes drawn by shaders (WebGL) ---- */