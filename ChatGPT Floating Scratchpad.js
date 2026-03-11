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

let headerEl;
let windowMode = "normal";
let previousBounds = null;
let waitAbortController = null;

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
    headerEl=header;

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
        fontSize:"13px",
        tabSize:"4"
    });

    textarea.value=localStorage.getItem("tm_editor_content")||"";

    textarea.addEventListener("input",()=>{
        localStorage.setItem("tm_editor_content",textarea.value);
    });

    textarea.addEventListener("keydown",(e)=>{

        const val=textarea.value;
        const cur=textarea.selectionStart;
        const sel=textarea.selectionEnd;

        /* Enter — auto-indent to match current line */

        if(e.key==="Enter"&&!e.shiftKey&&!e.ctrlKey&&!e.altKey){

            e.preventDefault();

            const lineStart=val.lastIndexOf("\n",cur-1)+1;
            const lineText=val.substring(lineStart,cur);
            const indent=lineText.match(/^[ ]*/)[0];

            const before=val.substring(0,cur);
            const after=val.substring(sel);

            textarea.value=before+"\n"+indent+after;

            const newPos=cur+1+indent.length;
            textarea.selectionStart=textarea.selectionEnd=newPos;

            textarea.dispatchEvent(new Event("input"));
            return;
        }

        /* Tab — insert 4 spaces */

        if(e.key==="Tab"&&!e.shiftKey){

            e.preventDefault();

            const before=val.substring(0,cur);
            const after=val.substring(sel);

            textarea.value=before+"    "+after;
            textarea.selectionStart=textarea.selectionEnd=cur+4;

            textarea.dispatchEvent(new Event("input"));
            return;
        }

        /* Shift+Tab — remove up to 4 leading spaces */

        if(e.key==="Tab"&&e.shiftKey){

            e.preventDefault();

            const lineStart=val.lastIndexOf("\n",cur-1)+1;
            const lineText=val.substring(lineStart);
            const leadingSpaces=lineText.match(/^[ ]*/)[0].length;
            const remove=Math.min(4,leadingSpaces);

            if(remove>0){

                const before=val.substring(0,lineStart);
                const after=val.substring(lineStart+remove);

                textarea.value=before+after;

                const newPos=Math.max(lineStart,cur-remove);
                textarea.selectionStart=textarea.selectionEnd=newPos;

                textarea.dispatchEvent(new Event("input"));
            }

            return;
        }
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

    const indent=line.match(/^[ ]*/)[0];
    const trimmed=line.trimStart();

    if(trimmed.startsWith("/p ")){

        const prompt=trimmed.substring(3);

        waitAbortController=new AbortController();
        showWaitingUI();

        const response=await sendPromptToChatGPT(prompt);

        hideWaitingUI();
        waitAbortController=null;

        if(response){

            const indented=response
                .split("\n")
                .map(l=>indent+l)
                .join("\n");

            textarea.value=
                text.substring(0,start)+
                indented+
                text.substring(lineEnd);

            localStorage.setItem("tm_editor_content",textarea.value);
        }

        return;
    }

    alert(line);
}

/* ------------------------------- */
/* Waiting UI */
/* ------------------------------- */

function showWaitingUI(){

    if(!headerEl) return;

    while(headerEl.firstChild){
        if(headerEl.firstChild===headerEl.querySelector("div")) break;
        headerEl.removeChild(headerEl.firstChild);
    }

    const indicator=document.createElement("span");
    indicator.className="tm-wait-indicator";

    const spinner=document.createElement("span");
    spinner.textContent="⟳";

    Object.assign(spinner.style,{
        display:"inline-block",
        animation:"tm-spin 1s linear infinite",
        marginRight:"6px",
        fontSize:"14px"
    });

    const label=document.createElement("span");
    label.textContent="Waiting...";

    indicator.appendChild(spinner);
    indicator.appendChild(label);

    const cancelBtn=document.createElement("button");
    cancelBtn.className="tm-cancel-btn";
    cancelBtn.textContent="Cancel";

    Object.assign(cancelBtn.style,{
        marginLeft:"10px",
        background:"#c0392b",
        color:"white",
        border:"none",
        borderRadius:"4px",
        padding:"2px 8px",
        cursor:"pointer",
        fontSize:"11px"
    });

    cancelBtn.onclick=(e)=>{
        e.stopPropagation();
        if(waitAbortController) waitAbortController.abort();
    };

    headerEl.insertBefore(indicator,headerEl.firstChild);
    headerEl.insertBefore(cancelBtn,headerEl.querySelector("div"));
}

function hideWaitingUI(){

    if(!headerEl) return;

    const indicator=headerEl.querySelector(".tm-wait-indicator");
    if(indicator) indicator.remove();

    const cancelBtn=headerEl.querySelector(".tm-cancel-btn");
    if(cancelBtn) cancelBtn.remove();

    const existing=headerEl.firstChild;
    if(!existing||existing.nodeType!==Node.TEXT_NODE||existing.textContent!=="Editor"){

        const textNode=document.createTextNode("Editor");

        if(headerEl.firstChild){
            headerEl.insertBefore(textNode,headerEl.firstChild);
        }else{
            headerEl.appendChild(textNode);
        }
    }
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

    const previousCount=document.querySelectorAll(
        '[data-message-author-role="assistant"]'
    ).length;

    const ok=await insertTextIntoChatGPT(prompt);

    if(!ok) return null;

    const sendButton=await waitForSendButton();

    if(!sendButton){
        alert("Send button not found");
        return null;
    }

    sendButton.click();

    return await waitForAssistantResponse(previousCount);
}

/* ------------------------------- */
/* Response Cleaning */
/* ------------------------------- */

function extractCleanText(messageEl){

    const clone=messageEl.cloneNode(true);

    /* Remove sticky code-block header bars (language label + copy button) */

    clone.querySelectorAll("pre div.sticky").forEach(el=>el.remove());

    /* Remove copy buttons by aria-label */

    clone.querySelectorAll('button[aria-label="Copy"]').forEach(el=>el.remove());

    /* Also remove any remaining copy buttons by text content */

    clone.querySelectorAll("button").forEach(btn=>{

        const text=btn.textContent.trim().toLowerCase();

        if(text==="copy code"||text==="copy"||text==="copied!"){
            btn.remove();
        }
    });

    /*
        Code blocks use CodeMirror (cm-content) with <br> for line breaks.
        innerText can lose these breaks, so we extract code blocks separately,
        replace them with a placeholder, then stitch the result back together.
    */

    const codeBlocks=clone.querySelectorAll(".cm-content");
    const codePlaceholders=[];

    codeBlocks.forEach(cm=>{

        const lines=[];
        let currentLine="";

        cm.childNodes.forEach(node=>{

            if(node.nodeName==="BR"){
                lines.push(currentLine);
                currentLine="";
            }
            else{
                currentLine+=node.textContent;
            }
        });

        if(currentLine) lines.push(currentLine);

        const codeText=lines.join("\n");
        const placeholder="__CODE_BLOCK_"+codePlaceholders.length+"__";
        codePlaceholders.push(codeText);

        cm.textContent=placeholder;
    });

    let result=clone.innerText.trim();

    /* Restore code blocks from placeholders */

    codePlaceholders.forEach((code,i)=>{
        result=result.replace("__CODE_BLOCK_"+i+"__",code);
    });

    /* Strip markdown-style code fences that may remain */

    result=result.replace(/^```[\w]*\n?/gm,"").replace(/^```\s*$/gm,"");

    return result.trim();
}

const STOP_BTN_SELECTOR=[
    'button[data-testid="stop-button"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop"]'
].join(",");

function waitForAssistantResponse(previousCount){

    const signal=waitAbortController?waitAbortController.signal:null;

    return new Promise(resolve=>{

        let phase=1;

        const interval=setInterval(()=>{

            if(signal&&signal.aborted){
                clearInterval(interval);
                resolve(null);
                return;
            }

            const messages=document.querySelectorAll(
                '[data-message-author-role="assistant"]'
            );

            /* Phase 1: wait for a NEW assistant message */

            if(phase===1){

                if(messages.length>previousCount){
                    phase=2;
                }

                return;
            }

            /* Phase 2: wait for the stop button to disappear */

            if(phase===2){

                const stopBtn=document.querySelector(STOP_BTN_SELECTOR);

                if(!stopBtn){
                    phase=3;

                    setTimeout(()=>{

                        if(signal&&signal.aborted){
                            clearInterval(interval);
                            resolve(null);
                            return;
                        }

                        clearInterval(interval);

                        const finalMessages=document.querySelectorAll(
                            '[data-message-author-role="assistant"]'
                        );

                        const last=finalMessages[finalMessages.length-1];
                        resolve(last?extractCleanText(last):"");

                    },500);
                }

                return;
            }

        },500);
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

const tmStyle=document.createElement("style");
tmStyle.textContent=`@keyframes tm-spin{to{transform:rotate(360deg)}}`;
document.head.appendChild(tmStyle);

})();