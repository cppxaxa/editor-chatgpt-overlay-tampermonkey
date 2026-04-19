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

let activeTab = "editor";       // "editor", "ascii", "question", "snippets", or "spreview"
let asciiTA;                     // read-only textarea for ASCII diagrams
let asciiCache = { hash: null, content: "" };
const ASCII_CACHE_KEY = "tm_ascii_cache";
let checkCache = { hash: null, parsed: null, body: "" };
let editorTabBtn;                // tab button references for styling
let asciiTabBtn;
let questionTabBtn;
let snippetsTabBtn;
let spreviewTabBtn;
let questionTA;                  // read-only textarea for question display
let questionCache = { hash: null, content: "" };
const QUESTION_CACHE_KEY = "tm_question_cache";
let snippetsTA;                  // read-only textarea for snippets display
let snippetsCache = { hash: null, content: "" };
const SNIPPETS_CACHE_KEY = "tm_snippets_cache";
let spreviewFrame;               // iframe for syntax-highlighted preview
let spreviewCache = { hash: null, content: "" };
const SPREVIEW_CACHE_KEY = "tm_spreview_cache";

/* Per-tab cursor and scroll position */
const tabState = {
    editor:   { scrollTop:0, selStart:0, selEnd:0 },
    ascii:    { scrollTop:0, selStart:0, selEnd:0 },
    question: { scrollTop:0, selStart:0, selEnd:0 },
    snippets: { scrollTop:0, selStart:0, selEnd:0 },
    spreview: { scrollTop:0, selStart:0, selEnd:0 }
};

/* Undo/redo stack for Editor tab */
const undoStack = [];
const redoStack = [];
const UNDO_MAX = 200;
let undoTimer = null;
let isUndoRedo = false; /* guard to avoid pushing while restoring */

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

    /* Tab bar replaces static "Editor" label */

    const tabBar=document.createElement("div");
    tabBar.className="tm-tab-bar";
    Object.assign(tabBar.style,{
        display:"flex",
        gap:"0",
        flexShrink:"0"
    });

    editorTabBtn=document.createElement("button");
    editorTabBtn.textContent="Editor";

    asciiTabBtn=document.createElement("button");
    asciiTabBtn.textContent="Ascii design";

    questionTabBtn=document.createElement("button");
    questionTabBtn.textContent="Question";

    snippetsTabBtn=document.createElement("button");
    snippetsTabBtn.textContent="Snippets";

    spreviewTabBtn=document.createElement("button");
    spreviewTabBtn.textContent="S-Preview";

    [editorTabBtn,asciiTabBtn,questionTabBtn,snippetsTabBtn,spreviewTabBtn].forEach(btn=>{
        Object.assign(btn.style,{
            background:"transparent",
            color:"#999",
            border:"none",
            borderBottom:"2px solid transparent",
            padding:"4px 10px",
            cursor:"pointer",
            fontSize:"12px",
            fontFamily:"inherit"
        });
    });

    editorTabBtn.title="Alt+1";
    asciiTabBtn.title="Alt+2";
    questionTabBtn.title="Alt+3";
    snippetsTabBtn.title="Alt+4";
    spreviewTabBtn.title="Alt+5";

    editorTabBtn.style.color="white";
    editorTabBtn.style.borderBottomColor="#4fc3f7";

    editorTabBtn.onclick=(e)=>{
        e.stopPropagation();
        switchTab("editor");
    };
    asciiTabBtn.onclick=(e)=>{
        e.stopPropagation();
        switchTab("ascii");
    };
    questionTabBtn.onclick=(e)=>{
        e.stopPropagation();
        switchTab("question");
    };
    snippetsTabBtn.onclick=(e)=>{
        e.stopPropagation();
        switchTab("snippets");
    };
    spreviewTabBtn.onclick=(e)=>{
        e.stopPropagation();
        switchTab("spreview");
    };

    tabBar.appendChild(editorTabBtn);
    tabBar.appendChild(asciiTabBtn);
    tabBar.appendChild(questionTabBtn);
    tabBar.appendChild(snippetsTabBtn);
    tabBar.appendChild(spreviewTabBtn);
    header.appendChild(tabBar);

    /* Action buttons beside the Editor label */

    const actionBtns=document.createElement("div");
    actionBtns.className="tm-action-btns";
    Object.assign(actionBtns.style,{
        display:"flex",
        gap:"4px",
        marginLeft:"10px",
        alignItems:"center"
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

    const ghBtn=document.createElement("button");
    ghBtn.title="Project page on GitHub";

    /* GitHub Octocat SVG icon */
    ghBtn.innerHTML='<svg viewBox="0 0 16 16" width="12" height="12" fill="white"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';

    Object.assign(ghBtn.style,{
        background:"#555",
        color:"white",
        border:"none",
        borderRadius:"3px",
        padding:"3px 6px",
        cursor:"pointer",
        display:"flex",
        alignItems:"center"
    });

    ghBtn.onclick=(e)=>{
        e.stopPropagation();
        window.open("https://github.com/cppxaxa/editor-chatgpt-overlay-tampermonkey","_blank");
    };

    const regenBtn=document.createElement("button");
    regenBtn.textContent="↻";
    regenBtn.title="Regenerate Ascii/Question/Snippets (Alt+R)";

    Object.assign(regenBtn.style,{
        background:"#555",
        color:"white",
        border:"none",
        borderRadius:"3px",
        padding:"2px 8px",
        cursor:"pointer",
        fontSize:"13px"
    });

    regenBtn.onclick=(e)=>{
        e.stopPropagation();
        regenerateCurrentTab();
    };

    actionBtns.appendChild(regenBtn);
    actionBtns.appendChild(runBtn);
    actionBtns.appendChild(checkBtn);
    actionBtns.appendChild(ghBtn);
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
        color:"#c9a36a",
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
        pushUndoDebounced(textarea);
    });

    /* Seed undo stack with initial content */
    pushUndo(textarea.value,0);

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
            color:"#c9a36a",
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
            /* Push merged content to undo stack */
            const merged=mergeColumnContent();
            textarea.value=merged;
            localStorage.setItem("tm_editor_content",merged);
            pushUndoDebounced(textarea);
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

    /* ASCII design display area */

    asciiTA=document.createElement("textarea");
    asciiTA.readOnly=true;
    asciiTA.spellcheck=false;

    Object.assign(asciiTA.style,{
        flex:"1",
        width:"100%",
        resize:"none",
        background:"#1e1e1e",
        color:"#c9a36a",
        border:"none",
        outline:"none",
        padding:"10px",
        fontFamily:"monospace",
        fontSize:"13px",
        lineHeight:"18px",
        tabSize:"4",
        display:"none"
    });

    container.appendChild(asciiTA);

    /* Question display area */

    questionTA=document.createElement("textarea");
    questionTA.readOnly=true;
    questionTA.spellcheck=false;

    Object.assign(questionTA.style,{
        flex:"1",
        width:"100%",
        resize:"none",
        background:"#1e1e1e",
        color:"#c9a36a",
        border:"none",
        outline:"none",
        padding:"10px",
        fontFamily:"monospace",
        fontSize:"13px",
        lineHeight:"18px",
        tabSize:"4",
        display:"none"
    });

    container.appendChild(questionTA);

    /* Snippets display area */

    snippetsTA=document.createElement("textarea");
    /* Not read-only — allows visible blinking caret for keyboard navigation */
    snippetsTA.spellcheck=false;

    Object.assign(snippetsTA.style,{
        flex:"1",
        width:"100%",
        resize:"none",
        background:"#1e1e1e",
        color:"#c9a36a",
        border:"none",
        outline:"none",
        padding:"10px",
        fontFamily:"monospace",
        fontSize:"13px",
        lineHeight:"18px",
        tabSize:"4",
        display:"none"
    });

    container.appendChild(snippetsTA);

    /* S-Preview iframe for syntax-highlighted code */

    spreviewFrame=document.createElement("iframe");
    spreviewFrame.sandbox="allow-same-origin";

    Object.assign(spreviewFrame.style,{
        flex:"1",
        width:"100%",
        border:"none",
        display:"none",
        background:"#fff"
    });

    container.appendChild(spreviewFrame);

    /* Load ASCII cache from localStorage */
    try{
        const cached=localStorage.getItem(ASCII_CACHE_KEY);
        if(cached) asciiCache=JSON.parse(cached);
    }catch(e){}

    /* Load Question cache from localStorage */
    try{
        const cached=localStorage.getItem(QUESTION_CACHE_KEY);
        if(cached) questionCache=JSON.parse(cached);
    }catch(e){}

    /* Load Snippets cache from localStorage */
    try{
        const cached=localStorage.getItem(SNIPPETS_CACHE_KEY);
        if(cached) snippetsCache=JSON.parse(cached);
    }catch(e){}

    /* Load S-Preview cache from localStorage */
    try{
        const cached=localStorage.getItem(SPREVIEW_CACHE_KEY);
        if(cached) spreviewCache=JSON.parse(cached);
    }catch(e){}

    createResizeHandle();

    document.body.appendChild(container);

    const restored=restoreEditorState();

    if(!restored) centerEditor();

    minBtn.onclick=()=>{

        if(windowMode==="minimized"){

            /* Restore based on active tab */
            if(activeTab==="ascii"){
                asciiTA.style.display="block";
                asciiTA.focus();
            }else if(activeTab==="question"){
                questionTA.style.display="block";
                questionTA.focus();
            }else if(activeTab==="snippets"){
                snippetsTA.style.display="block";
                snippetsTA.focus();
            }else if(activeTab==="spreview"){
                spreviewFrame.style.display="block";
            }else{
                textarea.style.display="block";
            }
            if(previousBounds){
                container.style.left=previousBounds.left;
                container.style.top=previousBounds.top;
                container.style.width=previousBounds.width;
                container.style.height=previousBounds.height;
            }else{
                container.style.height="350px";
            }
            resizeHandle.style.display="block";
            windowMode="normal";
        }
        else{

            /* If minimizing from maximized, tear down column layout first */
            if(windowMode==="maximized" && activeTab==="editor"){
                exitMaximizedColumnLayout();
            }

            previousBounds={
                left:container.style.left,
                top:container.style.top,
                width:container.style.width,
                height:container.style.height
            };

            textarea.style.display="none";
            columnContainer.style.display="none";
            asciiTA.style.display="none";
            questionTA.style.display="none";
            snippetsTA.style.display="none";
            spreviewFrame.style.display="none";
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
            if(activeTab==="editor"){
                enterMaximizedColumnLayout();
            }
            /* If ascii tab is active, asciiTA already visible full-width */
        }
        else{

            if(activeTab==="editor"){
                exitMaximizedColumnLayout();
            }

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
/* Undo / Redo                     */
/* ------------------------------- */

function pushUndo(value,cursorPos){
    if(isUndoRedo) return;
    /* Avoid duplicate consecutive entries */
    if(undoStack.length>0 && undoStack[undoStack.length-1].value===value) return;
    undoStack.push({value:value,cursor:cursorPos});
    if(undoStack.length>UNDO_MAX) undoStack.shift();
    redoStack.length=0; /* clear redo on new edit */
}

function pushUndoDebounced(ta){
    if(isUndoRedo) return;
    clearTimeout(undoTimer);
    undoTimer=setTimeout(()=>{
        pushUndo(ta.value,ta.selectionStart);
    },300);
}

function doUndo(ta){
    if(undoStack.length===0) return;

    /* Save current state to redo */
    redoStack.push({value:ta.value,cursor:ta.selectionStart});

    const entry=undoStack.pop();
    isUndoRedo=true;
    ta.value=entry.value;
    ta.selectionStart=ta.selectionEnd=entry.cursor;
    localStorage.setItem("tm_editor_content",ta.value);
    isUndoRedo=false;
}

function doRedo(ta){
    if(redoStack.length===0) return;

    /* Save current state to undo */
    undoStack.push({value:ta.value,cursor:ta.selectionStart});

    const entry=redoStack.pop();
    isUndoRedo=true;
    ta.value=entry.value;
    ta.selectionStart=ta.selectionEnd=entry.cursor;
    localStorage.setItem("tm_editor_content",ta.value);
    isUndoRedo=false;
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

        /* Ctrl+Z / Ctrl+Y — custom undo/redo for editor textareas only */
        const isEditorTA=(ta===textarea||ta===leftTA||ta===rightTA);
        if(isEditorTA && e.ctrlKey && !e.shiftKey && !e.altKey){
            if(e.key.toLowerCase()==="z"){
                e.preventDefault();
                doUndo(textarea);
                if(windowMode==="maximized"){
                    const lines=textarea.value.split("\n");
                    const lpc=getLinesPerCol();
                    syncing=true;
                    leftTA.value=lines.slice(0,lpc).join("\n");
                    rightTA.value=lines.slice(lpc).join("\n");
                    syncing=false;
                }
                return;
            }
            if(e.key.toLowerCase()==="y"){
                e.preventDefault();
                doRedo(textarea);
                if(windowMode==="maximized"){
                    const lines=textarea.value.split("\n");
                    const lpc=getLinesPerCol();
                    syncing=true;
                    leftTA.value=lines.slice(0,lpc).join("\n");
                    rightTA.value=lines.slice(lpc).join("\n");
                    syncing=false;
                }
                return;
            }
        }

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
/* Tab Switching & ASCII Design    */
/* ------------------------------- */

function simpleHash(str){
    let hash=5381;
    for(let i=0;i<str.length;i++){
        hash=((hash<<5)+hash)+str.charCodeAt(i);
        hash|=0; // Convert to 32-bit int
    }
    return hash.toString(36);
}

function getEditorContent(){
    if(windowMode==="maximized"){
        return mergeColumnContent();
    }
    return textarea.value;
}

function updateTabStyles(){
    [editorTabBtn,asciiTabBtn,questionTabBtn,snippetsTabBtn,spreviewTabBtn].forEach(btn=>{
        btn.style.color="#999";
        btn.style.borderBottomColor="transparent";
    });
    const active={editor:editorTabBtn,ascii:asciiTabBtn,question:questionTabBtn,snippets:snippetsTabBtn,spreview:spreviewTabBtn}[activeTab];
    if(active){
        active.style.color="white";
        active.style.borderBottomColor="#4fc3f7";
    }
}

function getTabTA(tab){
    if(tab==="ascii") return asciiTA;
    if(tab==="question") return questionTA;
    if(tab==="snippets") return snippetsTA;
    return textarea;
}

function saveTabState(tab){
    if(tab==="spreview"){
        try{ tabState.spreview.scrollTop=spreviewFrame.contentWindow.scrollY||0; }catch(e){}
        return;
    }
    const ta=getTabTA(tab);
    if(!ta) return;
    tabState[tab]={
        scrollTop:ta.scrollTop,
        selStart:ta.selectionStart,
        selEnd:ta.selectionEnd
    };
}

function restoreTabState(tab){
    if(tab==="spreview"){
        try{ spreviewFrame.contentWindow.scrollTo(0,tabState.spreview.scrollTop); }catch(e){}
        return;
    }
    const ta=getTabTA(tab);
    if(!ta) return;
    const s=tabState[tab];
    ta.scrollTop=s.scrollTop;
    ta.selectionStart=s.selStart;
    ta.selectionEnd=s.selEnd;
}

function regenerateCurrentTab(){
    const code=getEditorContent();
    const hash=simpleHash(code);

    if(activeTab==="ascii"){
        asciiCache={hash:null,content:""};
        asciiTA.value="Regenerating ASCII diagram...";
        generateAsciiDiagram(code,hash);
    }else if(activeTab==="question"){
        questionCache={hash:null,content:""};
        questionTA.value="Regenerating question...";
        generateQuestion(code,hash);
    }else if(activeTab==="snippets"){
        snippetsCache={hash:null,content:""};
        snippetsTA.value="Regenerating snippets...";
        generateSnippets(code,hash);
    }else if(activeTab==="spreview"){
        spreviewCache={hash:null,content:""};
        setSpreviewContent("<p style='font-family:monospace;padding:20px;color:#555'>Regenerating preview...</p>");
        generateSpreview(code,hash);
    }
}

function switchTab(tabName){

    if(tabName===activeTab) return;

    /* Save outgoing tab state */
    saveTabState(activeTab);

    activeTab=tabName;
    updateTabStyles();

    if(tabName==="editor"){

        /* Abort any in-flight generation */
        if(waitAbortController){
            waitAbortController.abort();
        }

        asciiTA.style.display="none";
        questionTA.style.display="none";
        snippetsTA.style.display="none";
        spreviewFrame.style.display="none";

        if(windowMode==="maximized"){
            columnContainer.style.display="flex";
            (lastFocusedTA||leftTA).focus();
            restoreTabState("editor");
        }else{
            textarea.style.display="block";
            textarea.focus();
            restoreTabState("editor");
        }
        return;
    }

    /* Hide editor areas for non-editor tabs */
    textarea.style.display="none";
    columnContainer.style.display="none";
    asciiTA.style.display="none";
    questionTA.style.display="none";
    snippetsTA.style.display="none";
    spreviewFrame.style.display="none";

    if(tabName==="ascii"){

        asciiTA.style.display="block";
        asciiTA.focus();

        const code=getEditorContent();
        const hash=simpleHash(code);

        if(hash===asciiCache.hash && asciiCache.content){
            asciiTA.value=asciiCache.content;
            restoreTabState("ascii");
            return;
        }

        asciiTA.value="Generating ASCII diagram...";
        generateAsciiDiagram(code,hash);
        return;
    }

    if(tabName==="question"){

        questionTA.style.display="block";
        questionTA.focus();

        /* Show cached content if available, otherwise prompt user to regenerate */
        if(questionCache.content){
            questionTA.value=questionCache.content;
            restoreTabState("question");
        }else{
            questionTA.value="(Press ↻ or Alt+R to generate question)";
        }
        return;
    }

    if(tabName==="snippets"){

        snippetsTA.style.display="block";
        snippetsTA.focus();

        const code=getEditorContent();
        const hash=simpleHash(code);

        if(hash===snippetsCache.hash && snippetsCache.content){
            snippetsTA.value=snippetsCache.content;
            restoreTabState("snippets");
            return;
        }

        snippetsTA.value="Generating snippets...";
        generateSnippets(code,hash);
    }

    if(tabName==="spreview"){

        spreviewFrame.style.display="block";

        const code=getEditorContent();
        const hash=simpleHash(code);

        if(hash===spreviewCache.hash && spreviewCache.content){
            setSpreviewContent(spreviewCache.content);
            restoreTabState("spreview");
            return;
        }

        setSpreviewContent("<p style='font-family:monospace;padding:20px;color:#555'>Generating preview...</p>");
        generateSpreview(code,hash);
    }
}

async function generateAsciiDiagram(code,hash){

    waitAbortController=new AbortController();
    showWaitingUI();

    const prompt="Analyze the following code and create an ASCII box diagram showing its architecture, "+
        "main components, and their relationships. Use simple ASCII box drawing characters "+
        "(+, -, |, >, arrows). Keep it concise and readable. Respond ONLY with the ASCII "+
        "diagram, no explanations enclosed inside triple quotes pair : \"```md and ```\", denoting code."+
        "\n\nCode:\n"+code;

    try{
        const response=await sendPromptToChatGPT(prompt);

        if(waitAbortController && waitAbortController.signal.aborted){
            return;
        }

        if(response){
            asciiCache={hash:hash,content:response};

            try{
                localStorage.setItem(ASCII_CACHE_KEY,JSON.stringify(asciiCache));
            }catch(e){}

            if(activeTab==="ascii"){
                asciiTA.value=response;
            }
        }else{
            if(activeTab==="ascii"){
                asciiTA.value="(Failed to generate ASCII diagram)";
            }
        }
    }catch(e){
        if(activeTab==="ascii"){
            asciiTA.value="(Error generating ASCII diagram: "+e.message+")";
        }
    }finally{
        waitAbortController=null;
        hideWaitingUI();
    }
}

async function generateQuestion(code,hash){

    waitAbortController=new AbortController();
    showWaitingUI();

    const prompt="Analyze the following code (it may be partial/half-written) and figure out what problem it is solving. "+
        "If it is a LeetCode problem, identify the question number and title. Follow this EXACT format:\n\n"+
        "Title: [LeetCode #number] Problem Title\n"+
        "(If you cannot identify the exact LeetCode question, use: [x] Unable to identify LeetCode question - Best guess: <title>)\n\n"+
        "## Question\n<Full problem statement>\n\n"+
        "## Constraints\n<List all constraints>\n\n"+
        "## Example 1\nInput: ...\nOutput: ...\nExplanation: ...\n\n"+
        "## Example 2\nInput: ...\nOutput: ...\nExplanation: ...\n\n"+
        "## Hints\n<2-3 hints>\n\n"+
        "## Companies Asked\n<List of companies known to ask this>\n\n"+
        "## Expected Complexity (Interview)\nTime: O(...)\nSpace: O(...)\n\n"+
        "## Topics\n<List of relevant topics/tags>\n\n"+
        "If it is NOT a LeetCode question, still frame the problem the code is trying to solve with corner cases, expected TC and SC.\n"+
        "You may use ASCII diagrams where helpful.\n"+
        "Enclose your ENTIRE response inside ```md and ``` so it is treated as markdown code.\n\n"+
        "Code:\n"+code;

    try{
        const response=await sendPromptToChatGPT(prompt);

        if(waitAbortController && waitAbortController.signal.aborted){
            return;
        }

        if(response){
            questionCache={hash:hash,content:response};

            try{
                localStorage.setItem(QUESTION_CACHE_KEY,JSON.stringify(questionCache));
            }catch(e){}

            if(activeTab==="question"){
                questionTA.value=response;
            }
        }else{
            if(activeTab==="question"){
                questionTA.value="(Failed to generate question)";
            }
        }
    }catch(e){
        if(activeTab==="question"){
            questionTA.value="(Error generating question: "+e.message+")";
        }
    }finally{
        waitAbortController=null;
        hideWaitingUI();
    }
}

async function generateSnippets(code,hash){

    waitAbortController=new AbortController();
    showWaitingUI();

    const prompt="Analyze the following code and understand what problem it is solving. "+
        "Then provide reusable, well-known algorithm and utility functions that would help solve this problem. "+
        "These should be GENERIC helper functions that a developer would commonly memorize and reuse across many "+
        "LeetCode problems or projects — things like BFS, DFS, Union-Find, binary search, LIS, topological sort, "+
        "segment tree operations, GCD/LCM, prefix sums, sliding window helpers, trie operations, Dijkstra, "+
        "Floyd-Warshall, KMP, matrix exponentiation, etc.\n\n"+
        "IMPORTANT — Also scan the code for:\n"+
        "1. Functions that are CALLED but never defined (missing implementations)\n"+
        "2. Functions that have EMPTY bodies or only placeholder/stub content (e.g. TODO, throw NotImplemented, pass, return default)\n"+
        "Provide full working implementations for ALL such functions too, placed BEFORE the generic helpers.\n\n"+
        "Rules:\n"+
        "- Wrap all functions inside a `class Helper` with static methods\n"+
        "- Each function must be self-contained — only depends on its inputs, no external state\n"+
        "- Match the programming language used in the code. If the language is unclear, default to C#\n"+
        "- Include FULL function bodies (not stubs) — complete, working implementations\n"+
        "- Add a brief one-line comment above each function describing what it does\n"+
        "- For missing/empty functions found in the code, add a comment like: // [Missing from code] or // [Stub in code]\n"+
        "- Only include generic helpers genuinely relevant to solving this type of problem\n"+
        "- These should be the kind of well-known algorithms that experienced developers recall from memory\n"+
        "- Enclose your ENTIRE response inside ```md and ``` so it is treated as code\n\n"+
        "Code:\n"+code;

    try{
        const response=await sendPromptToChatGPT(prompt);

        if(waitAbortController && waitAbortController.signal.aborted){
            return;
        }

        if(response){
            snippetsCache={hash:hash,content:response};

            try{
                localStorage.setItem(SNIPPETS_CACHE_KEY,JSON.stringify(snippetsCache));
            }catch(e){}

            if(activeTab==="snippets"){
                snippetsTA.value=response;
            }
        }else{
            if(activeTab==="snippets"){
                snippetsTA.value="(Failed to generate snippets)";
            }
        }
    }catch(e){
        if(activeTab==="snippets"){
            snippetsTA.value="(Error generating snippets: "+e.message+")";
        }
    }finally{
        waitAbortController=null;
        hideWaitingUI();
    }
}

function setSpreviewContent(html){
    /* Inject a CSS reset to guarantee indentation is preserved */
    const cssReset='<style>pre,code{white-space:pre!important;tab-size:4!important}td pre{margin:0!important}</style>';
    if(html.indexOf('<head')!==-1){
        html=html.replace(/<head[^>]*>/i,m=>m+cssReset);
    }else if(html.indexOf('<html')!==-1){
        html=html.replace(/<html[^>]*>/i,m=>m+cssReset);
    }else{
        html=cssReset+html;
    }
    spreviewFrame.srcdoc=html;
}

async function generateSpreview(code,hash){

    waitAbortController=new AbortController();
    showWaitingUI();

    const prompt="Take the following source code and produce a single, self-contained HTML document that displays it "+
        "with advanced, IDE-quality syntax highlighting. Requirements:\n\n"+
        "1. Use inline CSS only (no external stylesheets or JS)\n"+
        "2. Light background (#fff) with high-contrast, WCAG AA compliant colors\n"+
        "3. Color categories (colorblind-friendly palette):\n"+
        "   - Language keywords (if, else, for, return, new, var, class, public, static, async, etc.): bold blue (#0550ae)\n"+
        "   - Type names, class names, framework types (int, long, string, bool, List, Dictionary, PriorityQueue, "+
        "HashSet, Array, Tuple, Task, etc.): teal (#0e7c6b) — color EVERY occurrence including in generics like List<int>\n"+
        "   - Numbers, numeric constants, and built-in constants (long.MaxValue, int.MinValue, null, true, false): purple (#6f42c1)\n"+
        "   - Strings and char literals: dark red (#a31515)\n"+
        "   - Method calls and function names (.Add, .Enqueue, .TryDequeue, .ToString, .Count, etc.): orange (#953800) — "+
        "color the dot AND the method name for EVERY call site\n"+
        "   - Comments: italic dark gray (#57606a)\n"+
        "   - Properties and member access (.Length, .Count, .Value): orange (#953800)\n"+
        "   - Regular identifiers: black (#24292f)\n"+
        "4. Important variables: Identify the semantically important variables in the code (function parameters, "+
        "key data structures, accumulators, result variables, graph/source/target/dist/result etc.). "+
        "Assign EACH important variable its own distinct soft pastel background color so they are visually "+
        "distinguishable at a glance. Use colors like: #fff3cd (warm yellow), #d1ecf1 (light blue), "+
        "#d4edda (light green), #f8d7da (light pink), #e2d9f3 (light lavender), #fde2c8 (light peach), "+
        "#d6eaf8 (sky blue), #dcedc8 (pale lime). Each variable gets ONE consistent color across ALL its "+
        "occurrences throughout the entire code — not just at declaration but EVERY usage. "+
        "Limit to 6-8 most important variables to avoid visual clutter.\n"+
        "5. Use a monospace font (Consolas, monospace), line numbers in a gutter column, and comfortable line spacing (1.5)\n"+
        "6. Detect the programming language automatically\n"+
        "7. CRITICAL: Preserve ALL indentation exactly. Use a <pre> element with white-space:pre. "+
        "Use a <table> layout where column 1 is the line number (right-aligned, gray, padding-right:1em) "+
        "and column 2 is the code line inside a <pre> with margin:0 and white-space:pre. "+
        "Do NOT trim or collapse any leading spaces or tabs.\n"+
        "8. Respond ONLY with the complete HTML document, nothing else — no explanations, no markdown fences\n\n"+
        "Code:\n"+code;

    try{
        const response=await sendPromptToChatGPT(prompt);

        if(waitAbortController && waitAbortController.signal.aborted){
            return;
        }

        if(response){
            /* The response might have markdown fences — strip them */
            let html=response
                .replace(/^```html?\n?/i,"")
                .replace(/```\s*$/,"")
                .trim();

            spreviewCache={hash:hash,content:html};

            try{
                localStorage.setItem(SPREVIEW_CACHE_KEY,JSON.stringify(spreviewCache));
            }catch(e){}

            if(activeTab==="spreview"){
                setSpreviewContent(html);
            }
        }else{
            if(activeTab==="spreview"){
                setSpreviewContent("<p style='font-family:monospace;padding:20px;color:red'>(Failed to generate preview)</p>");
            }
        }
    }catch(e){
        if(activeTab==="spreview"){
            setSpreviewContent("<p style='font-family:monospace;padding:20px;color:red'>(Error: "+e.message+")</p>");
        }
    }finally{
        waitAbortController=null;
        hideWaitingUI();
    }
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

        /* Alt+1..5 — switch tabs */
        if(e.altKey&&e.key==="1"){ e.preventDefault(); switchTab("editor"); }
        if(e.altKey&&e.key==="2"){ e.preventDefault(); switchTab("ascii"); }
        if(e.altKey&&e.key==="3"){ e.preventDefault(); switchTab("question"); }
        if(e.altKey&&e.key==="4"){ e.preventDefault(); switchTab("snippets"); }
        if(e.altKey&&e.key==="5"){ e.preventDefault(); switchTab("spreview"); }

        /* Alt+R — regenerate current tab */
        if(e.altKey&&e.key.toLowerCase()==="r"){ e.preventDefault(); regenerateCurrentTab(); }
    });
}

/* ------------------------------- */
/* Line Reader */
/* ------------------------------- */

/* Apply indent to a multi-line response: strip the response's own common
   leading whitespace, then prepend the desired indent to every line.
   This avoids double-indenting lines 2+ when ChatGPT already indents them. */

function applyIndent(response,indent){
    const lines=response.split("\n");
    /* The first line's leading whitespace is always stripped by extractCleanText's
       .trim(), so compute the common indent from lines 2+ only. */
    let minLead=Infinity;
    for(let i=1;i<lines.length;i++){
        if(lines[i].trim().length===0) continue;
        const lead=lines[i].match(/^[ ]*/)[0].length;
        if(lead<minLead) minLead=lead;
    }
    if(!isFinite(minLead)) minLead=0;

    return lines.map((l,i)=>{
        if(l.trim().length===0) return indent;
        if(i===0) return indent+l; /* first line already trimmed */
        return indent+l.substring(minLead);
    }).join("\n");
}

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

        /* Build full editor content for context */
        const fullContent=windowMode==="maximized"
            ? mergeColumnContent()
            : textarea.value;

        const allLines=fullContent.split("\n");

        /* Find which line the /p command is on (1-based).
           In maximized mode, offset by the left textarea's line count if editing in right. */
        let cmdLineIdx=text.substring(0,start).split("\n").length - 1;
        if(windowMode==="maximized" && ta===rightTA){
            cmdLineIdx+=leftTA.value.split("\n").length;
        }
        const cmdLineNum=cmdLineIdx+1;

        const numberedContext=allLines.map((l,i)=>{
            const num=i+1;
            const prefix=num+"> ";
            if(num===cmdLineNum) return prefix+l+"  ◄◄◄ COMMAND LINE";
            return prefix+l;
        }).join("\n");

        const contextualPrompt=
            `You are an inline code assistant. The user has a file open in their editor and has placed a command on line ${cmdLineNum}.

The command is: ${prompt}

Respond ONLY with the text that should replace the command line. No explanations, no markdown fences, no extra text. Your response will be pasted directly into the editor at line ${cmdLineNum}, replacing the command line. The response can be multiline. If your response should have indentation, respond back with \`\`\` encapsulation.

Here is the full editor content for context (line numbers are prefixed as "N> "):
\`\`\`
${numberedContext}
\`\`\``;

        waitAbortController=new AbortController();
        showWaitingUI();

        await yieldFrame(); /* let browser paint the spinner before proceeding */

        const response=await sendPromptToChatGPT(contextualPrompt);

        hideWaitingUI();
        waitAbortController=null;

        if(response){

            const indented=applyIndent(response,indent);

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

    /* /r — raw prompt, no context, no instructions */

    if(trimmed.startsWith("/r ")){

        const prompt=trimmed.substring(3);

        waitAbortController=new AbortController();
        showWaitingUI();

        await yieldFrame();

        const response=await sendPromptToChatGPT(prompt);

        hideWaitingUI();
        waitAbortController=null;

        if(response){

            const indented=applyIndent(response,indent);

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

    alert(line+"\n\n— Tip: /r {prompt} = raw prompt | /p {prompt} = prompt with context\n— Tabs: Alt+1 Editor | Alt+2 Ascii | Alt+3 Question | Alt+4 Snippets | Alt+5 S-Preview\n— Alt+I = Execute command | Alt+C = Code check | Alt+R = Regenerate tab\n— More: github.com/cppxaxa/editor-chatgpt-overlay-tampermonkey");
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

    const hash=simpleHash(code);

    /* If code hasn't changed, reuse cached result */
    if(hash===checkCache.hash && checkCache.parsed){
        showResultDialog("Code Check Result (cached)",checkCache.body);
        if(checkCache.parsed.markers&&checkCache.parsed.markers.length){
            if(windowMode==="maximized"){
                textarea.value=mergeColumnContent();
                insertMarkers(textarea, checkCache.parsed.markers);
                const lines=textarea.value.split("\n");
                const lpc=getLinesPerCol();
                leftTA.value=lines.slice(0,lpc).join("\n");
                rightTA.value=lines.slice(lpc).join("\n");
                saveMergedContent();
            } else {
                insertMarkers(textarea, checkCache.parsed.markers);
            }
        }
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

    /* Cache the result */
    checkCache={hash:hash,parsed:parsed,body:body};

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
        color:"#c9a36a",
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

    /* Hide action buttons and show waiting indicator in their place */
    const actionBtns=headerEl.querySelector(".tm-action-btns");
    if(actionBtns){
        /* Store original children so we can restore them */
        actionBtns._savedHTML=actionBtns.innerHTML;
        actionBtns.innerHTML="";
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

    if(actionBtns){
        actionBtns.appendChild(indicator);
        actionBtns.appendChild(cancelBtn);
    }
}

function hideWaitingUI(){

    if(!headerEl) return;

    const actionBtns=headerEl.querySelector(".tm-action-btns");
    if(actionBtns && actionBtns._savedHTML!=null){
        actionBtns.innerHTML=actionBtns._savedHTML;
        delete actionBtns._savedHTML;

        /* Re-attach click handlers since innerHTML destroyed them */
        const btns=actionBtns.querySelectorAll("button");
        btns.forEach(btn=>{
            if(btn.textContent==="↻"){
                btn.onclick=(e)=>{ e.stopPropagation(); regenerateCurrentTab(); };
            }else if(btn.textContent==="Command"){
                btn.onclick=(e)=>{ e.stopPropagation(); handleLineAction(); };
            }else if(btn.textContent==="Check"){
                btn.onclick=(e)=>{ e.stopPropagation(); handleCodeCheck(); };
            }else if(btn.querySelector("svg")){
                btn.onclick=(e)=>{ e.stopPropagation(); window.open("https://github.com/cppxaxa/editor-chatgpt-overlay-tampermonkey","_blank"); };
            }
        });
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