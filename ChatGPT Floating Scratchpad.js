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

let columnContainer;  // flex wrapper for the two column textareas
let leftTA;           // left textarea
let rightTA;          // right textarea
let syncing = false;  // guard against recursive input during redistribution
let lastFocusedTA = null; // track last focused textarea for button clicks

const MARKER_CHAR = "\u2B50"; // ⭐

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

    /* Action buttons beside the Editor label */

    const actionBtns=document.createElement("div");
    Object.assign(actionBtns.style,{
        display:"flex",
        gap:"4px",
        marginLeft:"10px"
    });

    const runBtn=document.createElement("button");
    runBtn.textContent="Command";
    runBtn.title="Execute line command (Alt+I)";

    const checkBtn=document.createElement("button");
    checkBtn.textContent="Check";
    checkBtn.title="Code check (Alt+C)";

    [runBtn,checkBtn].forEach(btn=>{
        Object.assign(btn.style,{
            background:"#555",
            color:"white",
            border:"none",
            borderRadius:"3px",
            padding:"2px 8px",
            cursor:"pointer",
            fontSize:"11px"
        });
    });

    runBtn.onclick=(e)=>{
        e.stopPropagation();
        handleLineAction();
    };

    checkBtn.onclick=(e)=>{
        e.stopPropagation();
        handleCodeCheck();
    };

    actionBtns.appendChild(runBtn);
    actionBtns.appendChild(checkBtn);
    header.appendChild(actionBtns);

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
        lineHeight:"18px",
        tabSize:"4"
    });

    textarea.value=localStorage.getItem("tm_editor_content")||"";

    textarea.addEventListener("input",()=>{
        localStorage.setItem("tm_editor_content",textarea.value);
    });

    attachEditorKeydown(textarea);

    container.appendChild(header);
    container.appendChild(textarea);

    /* Column layout for maximized mode */

    columnContainer = document.createElement("div");

    Object.assign(columnContainer.style,{
        display:"none",
        flex:"1",
        flexDirection:"row",
        gap:"0px",
        overflow:"hidden"
    });

    leftTA = document.createElement("textarea");
    rightTA = document.createElement("textarea");

    [leftTA, rightTA].forEach(col=>{

        col.spellcheck=false;
        col.setAttribute("autocomplete","off");
        col.setAttribute("autocorrect","off");
        col.setAttribute("autocapitalize","off");

        Object.assign(col.style,{
            flex:"1",
            resize:"none",
            margin:"0",
            padding:"10px",
            fontFamily:"monospace",
            fontSize:"13px",
            color:"#d4d4d4",
            background:"#1e1e1e",
            border:"none",
            outline:"none",
            tabSize:"4",
            lineHeight:"18px"
        });

        attachEditorKeydown(col);

        col.addEventListener("input",()=>{
            if(syncing) return;
            redistributeColumns();
        });
    });

    leftTA.style.borderRight="1px solid #333";

    /* Boundary navigation between columns */

    leftTA.addEventListener("keydown",(e)=>{

        if(windowMode!=="maximized") return;

        /* ArrowDown on last line → jump to right textarea */
        if(e.key==="ArrowDown"){
            const val=leftTA.value;
            const cur=leftTA.selectionStart;
            const after=val.substring(cur);
            if(after.indexOf("\n")===-1){
                e.preventDefault();
                rightTA.focus();
                rightTA.selectionStart=rightTA.selectionEnd=0;
            }
        }
    });

    rightTA.addEventListener("keydown",(e)=>{

        if(windowMode!=="maximized") return;
        const cur=rightTA.selectionStart;

        /* ArrowUp on first line → jump to left textarea */
        if(e.key==="ArrowUp"){
            const before=rightTA.value.substring(0,cur);
            if(before.indexOf("\n")===-1){
                e.preventDefault();
                leftTA.focus();
                leftTA.selectionStart=leftTA.selectionEnd=leftTA.value.length;
            }
        }

        /* Backspace at position 0 → pull last line from left */
        if(e.key==="Backspace" && cur===0 && rightTA.selectionEnd===0){
            e.preventDefault();
            const leftVal=leftTA.value;
            const lastNewline=leftVal.lastIndexOf("\n");
            if(lastNewline!==-1){
                /* Remove last newline from left, prepend that trailing text to right */
                const movedText=leftVal.substring(lastNewline+1);
                leftTA.value=leftVal.substring(0,lastNewline);
                rightTA.value=movedText+rightTA.value;
                rightTA.focus();
                rightTA.selectionStart=rightTA.selectionEnd=movedText.length;
            } else {
                /* Left has only one line — merge everything into left */
                leftTA.value=leftVal+rightTA.value;
                rightTA.value="";
                leftTA.focus();
                leftTA.selectionStart=leftTA.selectionEnd=leftVal.length;
            }
            saveMergedContent();
            redistributeColumns();
        }
    });

    columnContainer.appendChild(leftTA);
    columnContainer.appendChild(rightTA);
    container.appendChild(columnContainer);

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

            /* If minimizing from maximized, tear down column layout first */
            if(windowMode==="maximized"){
                exitMaximizedColumnLayout();
            }

            previousBounds={height:container.style.height};

            textarea.style.display="none";
            columnContainer.style.display="none";
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

            resizeHandle.style.display="none";

            windowMode="maximized";
            enterMaximizedColumnLayout();
        }
        else{

            exitMaximizedColumnLayout();

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
/* Editor Keydown (shared)         */
/* ------------------------------- */

function attachEditorKeydown(ta){

    /* Track last focused textarea so header buttons know which one to use */
    ta.addEventListener("focus",()=>{ lastFocusedTA=ta; });

    /* Remove markers when cursor touches them via keyboard */
    ta.addEventListener("keyup",(e)=>{

        if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Home","End"].includes(e.key)){
            removeMarkerAtCursor(ta);
        }
    });

    /* Remove ⚠ markers when cursor touches them via click */
    ta.addEventListener("mouseup",()=>{
        removeMarkerAtCursor(ta);
    });

    ta.addEventListener("keydown",(e)=>{

        const val=ta.value;
        const cur=ta.selectionStart;
        const sel=ta.selectionEnd;

        /* Enter — auto-indent to match current line */

        if(e.key==="Enter"&&!e.shiftKey&&!e.ctrlKey&&!e.altKey){

            e.preventDefault();

            const lineStart=val.lastIndexOf("\n",cur-1)+1;
            const lineText=val.substring(lineStart,cur);
            const indent=lineText.match(/^[ ]*/)[0];

            const before=val.substring(0,cur);
            const after=val.substring(sel);

            ta.value=before+"\n"+indent+after;

            const newPos=cur+1+indent.length;
            ta.selectionStart=ta.selectionEnd=newPos;

            ta.dispatchEvent(new Event("input"));
            return;
        }

        /* Tab — insert 4 spaces */

        if(e.key==="Tab"&&!e.shiftKey){

            e.preventDefault();

            const before=val.substring(0,cur);
            const after=val.substring(sel);

            ta.value=before+"    "+after;
            ta.selectionStart=ta.selectionEnd=cur+4;

            ta.dispatchEvent(new Event("input"));
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

                ta.value=before+after;

                const newPos=Math.max(lineStart,cur-remove);
                ta.selectionStart=ta.selectionEnd=newPos;

                ta.dispatchEvent(new Event("input"));
            }

            return;
        }
    });
}

/* ------------------------------- */
/* Column Layout (maximized)       */
/* ------------------------------- */

function getLinesPerCol(){

    const containerH=container.offsetHeight - headerEl.offsetHeight;
    return Math.max(1, Math.floor((containerH - 20) / 18));
}

function mergeColumnContent(){

    if(!rightTA.value) return leftTA.value;
    return leftTA.value+"\n"+rightTA.value;
}

function saveMergedContent(){

    const merged=mergeColumnContent();
    textarea.value=merged;
    localStorage.setItem("tm_editor_content",merged);
}

function redistributeColumns(){

    if(syncing) return;
    syncing=true;

    const focused=document.activeElement;
    const focusedIsLeft=(focused===leftTA);
    const focusedIsRight=(focused===rightTA);
    const savedCursor=focused? focused.selectionStart : 0;
    const savedSelEnd=focused? focused.selectionEnd : 0;

    const all=mergeColumnContent();
    const lines=all.split("\n");
    const lpc=getLinesPerCol();

    const leftText=lines.slice(0,lpc).join("\n");
    const rightText=lines.slice(lpc).join("\n");

    if(leftTA.value!==leftText) leftTA.value=leftText;
    if(rightTA.value!==rightText) rightTA.value=rightText;

    /* Restore cursor */
    if(focusedIsLeft){
        leftTA.selectionStart=Math.min(savedCursor,leftTA.value.length);
        leftTA.selectionEnd=Math.min(savedSelEnd,leftTA.value.length);
    } else if(focusedIsRight){
        rightTA.selectionStart=Math.min(savedCursor,rightTA.value.length);
        rightTA.selectionEnd=Math.min(savedSelEnd,rightTA.value.length);
    }

    saveMergedContent();
    syncing=false;
}

function enterMaximizedColumnLayout(){

    textarea.style.display="none";

    const lines=textarea.value.split("\n");
    const lpc=getLinesPerCol();

    leftTA.value=lines.slice(0,lpc).join("\n");
    rightTA.value=lines.slice(lpc).join("\n");

    columnContainer.style.display="flex";
    leftTA.focus();
}

function exitMaximizedColumnLayout(){

    textarea.value=mergeColumnContent();
    localStorage.setItem("tm_editor_content",textarea.value);

    columnContainer.style.display="none";
    textarea.style.display="block";
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

        /* If restored as maximized, the initial split happened before the
           container was visible (offsetHeight was 0). Re-split now. */
        if(windowMode==="maximized") redistributeColumns();
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

        if(e.altKey&&e.key.toLowerCase()==="c"){

            e.preventDefault();
            handleCodeCheck();
        }
    });
}

/* ------------------------------- */
/* Line Reader */
/* ------------------------------- */

async function handleLineAction(){

    if(!textarea) return;

    const activeTA=document.activeElement;
    const isEditor=(activeTA===textarea||activeTA===leftTA||activeTA===rightTA);
    const editorTA=isEditor? activeTA : lastFocusedTA;
    if(!editorTA) return;

    /* In maximized mode, work with the focused column textarea */
    const ta=(windowMode==="maximized")? editorTA : textarea;

    const cursor=ta.selectionStart;
    const text=ta.value;

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

        await yieldFrame(); /* let browser paint the spinner before proceeding */

        const response=await sendPromptToChatGPT(prompt);

        hideWaitingUI();
        waitAbortController=null;

        if(response){

            const indented=response
                .split("\n")
                .map(l=>indent+l)
                .join("\n");

            ta.value=
                text.substring(0,start)+
                indented+
                text.substring(lineEnd);

            ta.dispatchEvent(new Event("input"));
            localStorage.setItem("tm_editor_content",
                windowMode==="maximized"? mergeColumnContent() : textarea.value);
        }

        return;
    }

    alert(line);
}

/* ------------------------------- */
/* Code Check (Alt+C) */
/* ------------------------------- */

const CODE_CHECK_PROMPT=`Review the following code. Respond ONLY with a JSON object (no markdown, no fences, no extra text) in this exact format:

{
  "correct": true or false,
  "solves_problem": true or false,
  "summary": "one-line description of what the code does",
  "issues": ["issue 1", "issue 2"] or [] if none,
  "suggestions": ["suggestion 1"] or [] if none,
  "markers": [{"line": 1, "fixed": "corrected line content", "issue": "short reason"}] or [] if none
}

markers: for each issue you can pinpoint to a specific line, include:
- "line": the 1-based line number (use the "N> " prefix numbers shown below)
- "fixed": the corrected version of that line (just the code, without the "N> " prefix). Make minimal changes — only fix what is wrong.
- "issue": a short description of the problem

Each line in the code below is prefixed with its line number as "N> " (e.g. "1> ", "2> "). Use these numbers directly for the "line" field. The "fixed" field must NOT include the line number prefix.

Here is the code:
\`\`\`
`;

function insertMarkers(ta, markers){

    if(!markers||!markers.length) return;

    const valid=markers.filter(m=>m.line && typeof m.fixed==="string");
    if(!valid.length) return;

    const lines=ta.value.split("\n");

    valid.forEach(m=>{

        const lineIdx=m.line-1; // 1-based → 0-based
        if(lineIdx<0||lineIdx>=lines.length) return;

        const original=lines[lineIdx];
        const fixed=m.fixed;

        /* Strip leading whitespace from both before comparing,
           since ChatGPT often returns the fixed line without indentation */
        const origTrimmed=original.replace(/^[ \t]*/,"");
        const fixedTrimmed=fixed.replace(/^[ \t]*/,"");
        const indent=original.length - origTrimmed.length;

        /* Find the first position where the trimmed lines differ */
        let diffPos=0;
        while(diffPos<origTrimmed.length && diffPos<fixedTrimmed.length && origTrimmed[diffPos]===fixedTrimmed[diffPos]){
            diffPos++;
        }

        /* If they're identical, no marker needed */
        if(diffPos===origTrimmed.length && diffPos===fixedTrimmed.length) return;

        /* Insert ⚠ at the first difference, offset by the original indentation */
        const insertAt=indent+diffPos;
        lines[lineIdx]=original.substring(0,insertAt)+MARKER_CHAR+original.substring(insertAt);
    });

    ta.value=lines.join("\n");
    ta.dispatchEvent(new Event("input"));
}

function removeMarkerAtCursor(ta){

    const val=ta.value;
    const cur=ta.selectionStart;

    /* Check character at cursor and character before cursor */
    if(val[cur]===MARKER_CHAR){
        ta.value=val.substring(0,cur)+val.substring(cur+1);
        ta.selectionStart=ta.selectionEnd=cur;
        ta.dispatchEvent(new Event("input"));
        return true;
    }

    if(cur>0 && val[cur-1]===MARKER_CHAR){
        ta.value=val.substring(0,cur-1)+val.substring(cur);
        ta.selectionStart=ta.selectionEnd=cur-1;
        ta.dispatchEvent(new Event("input"));
        return true;
    }

    return false;
}

function clearAllMarkers(ta){

    if(ta.value.indexOf(MARKER_CHAR)===-1) return;
    const cur=ta.selectionStart;
    ta.value=ta.value.split(MARKER_CHAR).join("");
    ta.selectionStart=ta.selectionEnd=Math.min(cur,ta.value.length);
    ta.dispatchEvent(new Event("input"));
}

async function handleCodeCheck(){

    if(!textarea) return;

    const activeTA=document.activeElement;
    const isEditor=(activeTA===textarea||activeTA===leftTA||activeTA===rightTA);
    if(!isEditor && !lastFocusedTA) return;

    /* In maximized mode, use merged content from both columns */
    /* Clear old markers first so they don't pollute the prompt */
    if(windowMode==="maximized"){
        clearAllMarkers(leftTA);
        clearAllMarkers(rightTA);
        redistributeColumns();
    } else {
        clearAllMarkers(textarea);
    }

    const code=windowMode==="maximized"
        ? mergeColumnContent().trim()
        : textarea.value.trim();

    if(!code){
        alert("Editor is empty — nothing to check.");
        return;
    }

    waitAbortController=new AbortController();
    showWaitingUI();

    await yieldFrame(); /* let browser paint the spinner before proceeding */

    const numberedCode=code.split("\n").map((line,i)=>(i+1)+"> "+line).join("\n");

    const response=await sendPromptToChatGPT(CODE_CHECK_PROMPT+numberedCode+"\n```");

    hideWaitingUI();
    waitAbortController=null;

    if(!response) return;

    let parsed=null;

    try{

        /* Strip markdown fences if ChatGPT wraps the JSON */

        const cleaned=response
            .replace(/^```[\w]*\n?/gm,"")
            .replace(/```\s*$/gm,"")
            .trim();

        parsed=JSON.parse(cleaned);

    }catch(e){

        showResultDialog("Code Check — Raw Response",response);
        return;
    }

    const correct=parsed.correct?"✅ Yes":"❌ No";
    const solves=parsed.solves_problem?"✅ Yes":"❌ No";

    const issueList=parsed.issues&&parsed.issues.length
        ?parsed.issues.map((s,i)=>"  "+(i+1)+". "+s).join("\n")
        :"  None";

    const suggestionList=parsed.suggestions&&parsed.suggestions.length
        ?parsed.suggestions.map((s,i)=>"  "+(i+1)+". "+s).join("\n")
        :"  None";

    const body=
        "Correct: "+correct+"\n"+
        "Solves the problem: "+solves+"\n\n"+
        "Summary:\n  "+parsed.summary+"\n\n"+
        "Issues:\n"+issueList+"\n\n"+
        "Suggestions:\n"+suggestionList;

    showResultDialog("Code Check Result",body);

    /* Insert ⚠ markers at issue locations */
    if(parsed.markers&&parsed.markers.length){

        if(windowMode==="maximized"){
            /* Merge into main textarea, insert markers, then re-split */
            textarea.value=mergeColumnContent();
            insertMarkers(textarea, parsed.markers);
            const lines=textarea.value.split("\n");
            const lpc=getLinesPerCol();
            leftTA.value=lines.slice(0,lpc).join("\n");
            rightTA.value=lines.slice(lpc).join("\n");
            saveMergedContent();
        } else {
            insertMarkers(textarea, parsed.markers);
        }
    }
}

/* ------------------------------- */
/* Result Dialog */
/* ------------------------------- */

function showResultDialog(title,body){

    const existing=document.getElementById("tm-result-dialog");
    if(existing) existing.remove();

    const overlay=document.createElement("div");
    overlay.id="tm-result-dialog";

    Object.assign(overlay.style,{
        position:"fixed",
        inset:"0",
        background:"rgba(0,0,0,.55)",
        zIndex:"9999999",
        display:"flex",
        alignItems:"center",
        justifyContent:"center"
    });

    const dialog=document.createElement("div");

    Object.assign(dialog.style,{
        background:"#1e1e1e",
        color:"#d4d4d4",
        border:"1px solid #444",
        borderRadius:"10px",
        padding:"20px 24px",
        maxWidth:"520px",
        width:"90%",
        maxHeight:"70vh",
        overflowY:"auto",
        fontFamily:"monospace",
        fontSize:"13px",
        boxShadow:"0 12px 40px rgba(0,0,0,.6)"
    });

    const heading=document.createElement("div");

    Object.assign(heading.style,{
        fontSize:"15px",
        fontWeight:"bold",
        marginBottom:"14px",
        color:"white"
    });

    heading.textContent=title;

    const content=document.createElement("pre");

    Object.assign(content.style,{
        whiteSpace:"pre-wrap",
        wordBreak:"break-word",
        margin:"0",
        lineHeight:"1.5"
    });

    content.textContent=body;

    const closeBtn=document.createElement("button");
    closeBtn.textContent="Close";

    Object.assign(closeBtn.style,{
        marginTop:"16px",
        background:"#444",
        color:"white",
        border:"none",
        borderRadius:"6px",
        padding:"6px 18px",
        cursor:"pointer",
        fontSize:"13px",
        display:"block",
        marginLeft:"auto"
    });

    closeBtn.onclick=()=>overlay.remove();

    dialog.appendChild(heading);
    dialog.appendChild(content);
    dialog.appendChild(closeBtn);
    overlay.appendChild(dialog);

    overlay.addEventListener("click",(e)=>{
        if(e.target===overlay) overlay.remove();
    });

    document.body.appendChild(overlay);

    closeBtn.focus();
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

function yieldFrame(){return new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));}

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
        enterMaximizedColumnLayout();
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

window.addEventListener("resize",()=>{
    if(windowMode==="maximized") redistributeColumns();
});

const tmStyle=document.createElement("style");
tmStyle.textContent=`@keyframes tm-spin{to{transform:rotate(360deg)}}`;
document.head.appendChild(tmStyle);

})();