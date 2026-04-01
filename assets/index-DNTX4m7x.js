(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),e.crossOrigin===`use-credentials`?t.credentials=`include`:e.crossOrigin===`anonymous`?t.credentials=`omit`:t.credentials=`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e=`/assets/typescript-DEgB2qVC.svg`,t=document.getElementById(`letter-wrapper`),n=document.getElementById(`click-hint`),r=document.getElementById(`april-fool`),i=document.createTextNode(``);t.appendChild(i);var a=document.createElement(`img`);a.src=e,a.id=`cat-cursor`,a.alt=`🐱`,t.appendChild(a);var o=[`Hey Ghoul, it's nights!

There's something at the end of this letter —
just a heads up so you have something to look forward to.

Hope you've been up to stuff that's actually made you happy lately,
maybe got some energy back.
I've been doing pretty well on my end, lots of good things happening.

Really glad we're working together again.`,`I drew your cat Prince as the typing cursor —
body was way too hard to get right
so I found a reference online and traced it.

I know you won't mind though.
Because you've always been so gentle with me.`,`Anyway, one last thing:`],s=``,c=!1,l=80;function u(e){return new Promise(t=>setTimeout(t,e))}async function d(e){for(let t of e)s+=t,i.textContent=s,await u(/[,.!?—]/.test(t)?l*4:l)}function f(){n.classList.remove(`hidden`)}function p(){n.classList.add(`hidden`)}async function m(){return new Promise(e=>{c=!0,f();let t=()=>{c&&(c=!1,p(),document.removeEventListener(`click`,t),e())};document.addEventListener(`click`,t)})}async function h(){a.classList.add(`done`),r.classList.remove(`hidden`);let e=`APRIL FOOLS!!`.split(``);for(let t=0;t<e.length;t++){let n=document.createElement(`span`);n.className=`april-char`,n.textContent=e[t],n.style.animationDelay=`${t*180}ms`,r.appendChild(n),await u(180)}await u(1800),window.location.href=`https://www.youtube.com/watch?v=dQw4w9WgXcQ`}async function g(){await d(o[0]);for(let e=1;e<o.length;e++)await m(),await d(`

`+o[e]);await u(600),await h()}g();