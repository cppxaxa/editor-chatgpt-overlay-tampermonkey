// ==UserScript==
// @name         ChatGPT Floating Scratchpad
// @namespace    http://tampermonkey.net/
// @version      2026-03-11
// @description  Floating editor with ChatGPT prompt execution
// @match        https://chatgpt.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {

'use strict';

const EDITOR_STATE_KEY = "tm_editor_window_state";

let container;
let textarea;
let resizeHandle;

let windowMode = "normal";
let previousBounds = null;

/* ------------------------------- */
/* Editor Creation */
/* ------------------------------- */

function createEditor() {

    container = document.createElement("div");

    Object.assign(container.style,{
        position:"fixed",
        width:"500px",
        height:"350px",
        background:"#1e1e1e",
        border:"1px solid #333",
        borderRadius:"8px",
        zIndex:"999999",
        display:"none",
        flexDirection:"column",
        boxShadow:"0 10px 30px rgba(0,0,0,.5)",
        overflow:"hidden"
    });

    const header=document.createElement("div");

    Object.assign(header.style,{
        height:"36px",
        background:"#2a2a2a",
        color:"white",
        display:"flex",
        alignItems:"center",
        justifyContent:"space-between",
        padding:"0 10px",
        cursor:"move",
        fontSize:"13px"
    });

    header.textContent="Editor";

    const buttons=document.createElement("div");

    const minBtn=document.createElement("button");
    minBtn.textContent="—";

    const maxBtn=document.createElement("button");
    maxBtn.textContent="□";

    const closeBtn=document.createElement("button");
    closeBtn.textContent="×";

    [minBtn,maxBtn,closeBtn].forEach(btn=>{

        Object.assign(btn.style,{
            marginLeft:"6px",
            background:"#444",
            color:"white",
            border:"none",
            width:"24px",
            height:"24px",
            cursor:"pointer"
        });

        buttons.appendChild(btn);
    });

    header.appendChild(buttons);

    textarea=document.createElement("textarea");

    textarea.spellcheck=false;
    textarea.setAttribute("autocomplete","off");
    textarea.setAttribute("autocorrect","off");
    textarea.setAttribute("autocapitalize","off");

    Object.assign(textarea.style,{
        flex:"1",
        width:"100%",
        resize:"none",
        background:"#1e1e1e",
        color:"#d4d4d4",
        border:"none",
        outline:"none",
        padding:"10px",
        fontFamily:"monospace",
        fontSize:"13px"
    });

    textarea.value=localStorage.getItem("tm_editor_content")||"";

    textarea.addEventListener("input",()=>{
        localStorage.setItem("tm_editor_content",textarea.value);
    });

    container.appendChild(header);
    container.appendChild(textarea);

    createResizeHandle();

    document.body.appendChild(container);

    const restored=restoreEditorState();

    if(!restored) centerEditor();

    minBtn.onclick=()=>{

        if(windowMode==="minimized"){

            textarea.style.display="block";
            container.style.height=previousBounds?.height||"350px";
            resizeHandle.style.display="block";
            windowMode="normal";
        }
        else{

            previousBounds={height:container.style.height};

            textarea.style.display="none";
            resizeHandle.style.display="none";
            container.style.height="36px";

            windowMode="minimized";
        }

        saveEditorState();
    };

    maxBtn.onclick=()=>{

        if(windowMode!=="maximized"){

            previousBounds={
                left:container.style.left,
                top:container.style.top,
                width:container.style.width,
                height:container.style.height
            };

            container.style.left="0";
            container.style.top="0";
            container.style.width="100vw";
            container.style.height="100vh";

            textarea.style.display="block";
            resizeHandle.style.display="none";

            windowMode="maximized";
        }
        else{

            if(previousBounds){

                container.style.left=previousBounds.left;
                container.style.top=previousBounds.top;
                container.style.width=previousBounds.width;
                container.style.height=previousBounds.height;
            }

            resizeHandle.style.display="block";
            windowMode="normal";
        }

        saveEditorState();
    };

    closeBtn.onclick=()=>container.style.display="none";

    makeDraggable(container,header);
}

/* ------------------------------- */
/* Resize */
/* ------------------------------- */

function createResizeHandle(){

    resizeHandle=document.createElement("div");

    Object.assign(resizeHandle.style,{
        position:"absolute",
        width:"14px",
        height:"14px",
        right:"0",
        bottom:"0",
        cursor:"nwse-resize"
    });

    container.appendChild(resizeHandle);

    let resizing=false;
    let startX,startY,startWidth,startHeight;

    resizeHandle.addEventListener("mousedown",(e)=>{

        if(windowMode!=="normal") return;

        resizing=true;

        startX=e.clientX;
        startY=e.clientY;

        startWidth=container.offsetWidth;
        startHeight=container.offsetHeight;

        e.preventDefault();
    });

    document.addEventListener("mousemove",(e)=>{

        if(!resizing) return;

        const newWidth=startWidth+(e.clientX-startX);
        const newHeight=startHeight+(e.clientY-startY);

        container.style.width=Math.max(300,newWidth)+"px";
        container.style.height=Math.max(150,newHeight)+"px";
    });

    document.addEventListener("mouseup",()=>{

        if(resizing) saveEditorState();

        resizing=false;
    });
}

/* ------------------------------- */
/* Drag Window */
/* ------------------------------- */

function makeDraggable(element,handle){

    let isDown=false;
    let offsetX,offsetY;

    handle.addEventListener("mousedown",(e)=>{

        if(windowMode==="maximized") return;

        isDown=true;

        offsetX=e.clientX-element.offsetLeft;
        offsetY=e.clientY-element.offsetTop;
    });

    document.addEventListener("mouseup",()=>{

        if(isDown) saveEditorState();

        isDown=false;
    });

    document.addEventListener("mousemove",(e)=>{

        if(!isDown||windowMode==="maximized") return;

        element.style.left=e.clientX-offsetX+"px";
        element.style.top=e.clientY-offsetY+"px";
    });
}

/* ------------------------------- */
/* Center */
/* ------------------------------- */

function centerEditor(){

    const width=500;
    const height=350;

    container.style.left=(window.innerWidth-width)/2+"px";
    container.style.top=(window.innerHeight-height)/2+"px";
}

/* ------------------------------- */
/* Launcher */
/* ------------------------------- */

function createLauncher(){

    const btn=document.createElement("button");

    btn.textContent="E";

    Object.assign(btn.style,{
        position:"fixed",
        left:"10px",
        bottom:"90px",
        zIndex:"999999",
        width:"28px",
        height:"28px",
        background:"#202123",
        color:"white",
        border:"1px solid #444",
        borderRadius:"6px",
        cursor:"pointer",
        fontWeight:"bold"
    });

    btn.onclick=()=>{

        if(!container) createEditor();

        container.style.display="flex";
    };

    document.body.appendChild(btn);
}

/* ------------------------------- */
/* Hotkey */
/* ------------------------------- */

function registerLineReaderHotkey(){

    document.addEventListener("keydown",(e)=>{

        if(e.altKey&&e.key.toLowerCase()==="i"){

            e.preventDefault();
            handleLineAction();
        }
    });
}

/* ------------------------------- */
/* Line Reader */
/* ------------------------------- */

async function handleLineAction(){

    if(!textarea) return;
    if(document.activeElement!==textarea) return;

    const cursor=textarea.selectionStart;
    const text=textarea.value;

    const start=text.lastIndexOf("\n",cursor-1)+1;
    const end=text.indexOf("\n",cursor);

    const lineEnd=end===-1?text.length:end;
    const line=text.substring(start,lineEnd);

    if(line.startsWith("/p ")){

        const prompt=line.substring(3);

        const response=await sendPromptToChatGPT(prompt);

        if(response){

            textarea.value=
                text.substring(0,start)+
                response+
                text.substring(lineEnd);

            localStorage.setItem("tm_editor_content",textarea.value);
        }

        return;
    }

    alert(line);
}

/* ------------------------------- */
/* ChatGPT Automation */
/* ------------------------------- */

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

async function insertTextIntoChatGPT(prompt){

    const input=document.querySelector("#prompt-textarea");

    if(!input){
        alert("ChatGPT prompt box not found");
        return false;
    }

    input.focus();
    input.innerHTML="";

    document.execCommand("insertText",false,prompt);

    input.dispatchEvent(new InputEvent("input",{bubbles:true}));

    return true;
}

async function waitForSendButton(){

    for(let i=0;i<40;i++){

        const btn=document.querySelector(
            'button[data-testid="send-button"]:not([disabled])'
        );

        if(btn) return btn;

        await sleep(200);
    }

    return null;
}

async function sendPromptToChatGPT(prompt){

    const ok=await insertTextIntoChatGPT(prompt);

    if(!ok) return null;

    const sendButton=await waitForSendButton();

    if(!sendButton){
        alert("Send button not found");
        return null;
    }

    sendButton.click();

    return await waitForAssistantResponse();
}

function waitForAssistantResponse(){

    return new Promise(resolve=>{

        let lastLength=0;

        const interval=setInterval(()=>{

            const messages=document.querySelectorAll(
                '[data-message-author-role="assistant"]'
            );

            if(!messages.length) return;

            const last=messages[messages.length-1];
            const text=last.innerText.trim();

            if(!text) return;

            if(text.length===lastLength){

                clearInterval(interval);
                resolve(text);
            }

            lastLength=text.length;

        },1000);
    });
}

/* ------------------------------- */
/* Save / Restore */
/* ------------------------------- */

function saveEditorState(){

    if(!container) return;

    const state={
        left:container.style.left,
        top:container.style.top,
        width:container.style.width,
        height:container.style.height,
        windowMode,
        previousBounds
    };

    localStorage.setItem(EDITOR_STATE_KEY,JSON.stringify(state));
}

function restoreEditorState(){

    const raw=localStorage.getItem(EDITOR_STATE_KEY);

    if(!raw) return false;

    const state=JSON.parse(raw);

    container.style.left=state.left;
    container.style.top=state.top;
    container.style.width=state.width;
    container.style.height=state.height;

    windowMode=state.windowMode||"normal";
    previousBounds=state.previousBounds||null;

    if(windowMode==="maximized"){

        container.style.left="0";
        container.style.top="0";
        container.style.width="100vw";
        container.style.height="100vh";

        resizeHandle.style.display="none";
    }

    if(windowMode==="minimized"){

        textarea.style.display="none";
        container.style.height="36px";

        resizeHandle.style.display="none";
    }

    return true;
}

/* ------------------------------- */
/* Init */
/* ------------------------------- */

createLauncher();
registerLineReaderHotkey();

})();