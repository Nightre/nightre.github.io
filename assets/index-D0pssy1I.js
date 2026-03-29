(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),e.crossOrigin===`use-credentials`?t.credentials=`include`:e.crossOrigin===`anonymous`?t.credentials=`omit`:t.credentials=`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e=document.querySelector(`#app`);e.innerHTML=`
  <div class="container">
    <h1>花朵熄灯</h1>

    <div class="controls">
      <label>花瓣数：
        <select id="petal-count">${Array.from({length:17},(e,t)=>t+4).filter(e=>e%3!=0).map(e=>`<option value="${e}" ${e===8?`selected`:``}>${e}</option>`).join(``)}</select>
      </label>
      <button id="reset-btn">重置</button>
    </div>

    <div class="status" id="status">把所有花瓣关闭！</div>

    <div class="flower-container">
      <div class="flower" id="flower">
        <div class="center-pistil"></div>
      </div>
    </div>
  </div>
`;var t=8,n=[],r=[],i=document.getElementById(`flower`),a=document.getElementById(`petal-count`),o=document.getElementById(`reset-btn`),s=document.getElementById(`status`);function c(e){return[e,(e-1+t)%t,(e+1)%t]}function l(e){for(let t of c(e))n[t]=!n[t]}function u(){n=Array(t).fill(!1);for(let e=0;e<t*3;e++)l(Math.floor(Math.random()*t));n.every(e=>!e)&&l(0),m()}function d(){return n.every(e=>!e)}function f(){r.forEach(e=>e.classList.remove(`highlight`))}function p(e){if(f(),!d())for(let t of c(e))r[t]?.classList.add(`highlight`)}function m(){i.querySelectorAll(`.petal-wrapper`).forEach(e=>e.remove()),r=[];let e=40+t*4;n.forEach((n,a)=>{let o=a/t*360,c=document.createElement(`div`);c.className=`petal-wrapper`,c.style.transform=`rotate(${o}deg)`;let u=document.createElement(`div`);u.className=`petal ${n?`on`:`off`}`,u.style.top=`${-(e+100)}px`,u.addEventListener(`click`,()=>{d()||(l(a),m(),d()&&(s.textContent=`🌸 全部关闭！你赢了！`,s.classList.add(`win`)))}),u.addEventListener(`mouseenter`,()=>p(a)),u.addEventListener(`mouseleave`,()=>f()),c.appendChild(u),i.appendChild(c),r.push(u)})}a.addEventListener(`change`,()=>{t=parseInt(a.value),s.textContent=`把所有花瓣关闭！`,s.classList.remove(`win`),u()}),o.addEventListener(`click`,()=>{s.textContent=`把所有花瓣关闭！`,s.classList.remove(`win`),u()}),u();