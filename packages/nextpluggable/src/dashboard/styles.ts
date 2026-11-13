/** Dashboard styles, shipped as a string so the package needs no CSS tooling in the host site. Everything is scoped under `.np-root`. */
export const dashboardCss = `
.np-root{--np-bg:#f5f6f8;--np-surface:#fff;--np-surface-2:#f9fafb;--np-text:#111827;--np-muted:#667085;--np-border:#e4e7ec;--np-primary:#4f46e5;--np-primary-hover:#4338ca;--np-primary-soft:#eef2ff;--np-danger:#d92d20;--np-danger-soft:#fef3f2;--np-success:#067647;--np-success-soft:#ecfdf3;--np-warn:#b54708;--np-warn-soft:#fffaeb;--np-shadow:0 1px 2px rgba(16,24,40,.06),0 1px 3px rgba(16,24,40,.08);--np-radius:12px;--np-accent:var(--np-primary);
position:fixed;inset:0;z-index:2147483000;overflow-y:auto;background:var(--np-bg);color:var(--np-text);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;text-align:left}
@media (prefers-color-scheme:dark){.np-root{--np-bg:#0c0e13;--np-surface:#161a22;--np-surface-2:#1b202a;--np-text:#eceef2;--np-muted:#98a2b3;--np-border:#2a303c;--np-primary:#818cf8;--np-primary-hover:#a5b4fc;--np-primary-soft:#1e2140;--np-danger:#f97066;--np-danger-soft:#3a1614;--np-success:#47cd89;--np-success-soft:#0d2a1c;--np-warn:#fdb022;--np-warn-soft:#33240a;--np-shadow:0 1px 2px rgba(0,0,0,.4)}}
.np-root *,.np-root *::before,.np-root *::after{box-sizing:border-box}
.np-root h1,.np-root h2,.np-root h3,.np-root p,.np-root ul,.np-root ol,.np-root dl,.np-root dd{margin:0;padding:0}
.np-root ul,.np-root ol{list-style:none}
.np-root a{color:var(--np-primary);text-decoration:none}
.np-root a:hover{text-decoration:underline}
.np-root button,.np-root input,.np-root select,.np-root textarea{font:inherit;color:inherit}
.np-root :focus-visible{outline:2px solid var(--np-primary);outline-offset:2px}
.np-top{background:var(--np-surface);border-bottom:1px solid var(--np-border);position:sticky;top:0;z-index:5}
.np-top-in{max-width:1040px;margin:0 auto;padding:0 20px;display:flex;align-items:center;gap:20px;min-height:60px;flex-wrap:wrap}
.np-brand{display:flex;align-items:center;gap:10px;font-weight:650;font-size:16px;margin-right:auto;color:var(--np-text)!important;text-decoration:none!important}
.np-brand-mark{width:28px;height:28px;border-radius:8px;background:var(--np-primary);color:#fff;display:grid;place-items:center;font-size:15px}
.np-brand small{font-weight:400;color:var(--np-muted);font-size:13px}
.np-nav{display:flex;gap:4px;order:3;width:100%;margin:0 -8px;overflow-x:auto}
@media (min-width:720px){.np-nav{order:0;width:auto;margin:0}}
.np-nav a{padding:8px 12px;border-radius:8px;color:var(--np-muted);font-weight:500;white-space:nowrap;text-decoration:none!important}
.np-nav a:hover{color:var(--np-text);background:var(--np-surface-2)}
.np-nav a[aria-current=page]{color:var(--np-primary);background:var(--np-primary-soft)}
.np-main{max-width:1040px;margin:0 auto;padding:28px 20px 80px}
.np-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:20px;flex-wrap:wrap}
.np-head h1{font-size:24px;line-height:1.25;letter-spacing:-.01em}
.np-head p{color:var(--np-muted);margin-top:4px;max-width:60ch}
.np-card{background:var(--np-surface);border:1px solid var(--np-border);border-radius:var(--np-radius);box-shadow:var(--np-shadow)}
.np-pad{padding:20px}
.np-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--np-border);background:var(--np-surface);border-radius:8px;padding:8px 14px;font-weight:550;cursor:pointer;white-space:nowrap;text-decoration:none!important;color:var(--np-text)!important;min-height:38px}
.np-btn:hover{background:var(--np-surface-2)}
.np-btn:disabled{opacity:.55;cursor:not-allowed}
.np-btn-primary{background:var(--np-primary);border-color:var(--np-primary);color:#fff!important}
.np-btn-primary:hover{background:var(--np-primary-hover);border-color:var(--np-primary-hover)}
@media (prefers-color-scheme:dark){.np-btn-primary{color:#0c0e13!important}}
.np-btn-danger{color:var(--np-danger)!important}
.np-btn-danger-solid{background:var(--np-danger);border-color:var(--np-danger);color:#fff!important}
.np-btn-sm{padding:5px 10px;min-height:32px;font-size:14px}
.np-btn-link{border:0;background:none;padding:0;min-height:0;color:var(--np-primary)!important;font-weight:500;cursor:pointer}
.np-spin{width:14px;height:14px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;animation:np-spin .7s linear infinite;flex:none}
@keyframes np-spin{to{transform:rotate(360deg)}}
.np-list{display:grid;gap:12px}
.np-row{display:grid;grid-template-columns:auto minmax(0,1fr);gap:14px 16px;padding:18px 20px;align-items:start}
@media (min-width:720px){.np-row{grid-template-columns:auto minmax(0,1fr) auto;align-items:center}}
.np-row-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;grid-column:1/-1}
@media (min-width:720px){.np-row-actions{grid-column:auto;justify-content:flex-end}}
.np-icon{width:44px;height:44px;border-radius:10px;background:var(--np-primary-soft);display:grid;place-items:center;font-size:22px;flex:none;overflow:hidden}
.np-icon img{width:100%;height:100%;object-fit:cover}
.np-title{font-weight:650;font-size:16px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.np-title a{color:inherit}
.np-meta{color:var(--np-muted);font-size:14px}
.np-desc{color:var(--np-muted);margin-top:2px;overflow-wrap:anywhere}
.np-chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:2px 9px;border-radius:999px;background:var(--np-surface-2);color:var(--np-muted);border:1px solid var(--np-border);white-space:nowrap}
.np-chip::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.np-chip-on{background:var(--np-success-soft);color:var(--np-success);border-color:transparent}
.np-chip-warn{background:var(--np-warn-soft);color:var(--np-warn);border-color:transparent}
.np-links{display:flex;gap:6px 14px;flex-wrap:wrap;margin-top:8px;font-size:14px}
.np-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px}
.np-tile{padding:18px;display:flex;flex-direction:column;gap:12px}
.np-tile-head{display:flex;gap:12px;align-items:center}
.np-tile-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;padding-top:4px}
.np-adds{font-size:14px;color:var(--np-muted);display:grid;gap:4px}
.np-adds li{display:flex;gap:8px;overflow-wrap:anywhere}
.np-adds li::before{content:"+";color:var(--np-primary);font-weight:700}
.np-empty{text-align:center;padding:56px 24px}
.np-empty-art{font-size:40px;margin-bottom:10px}
.np-empty h2{font-size:19px;margin-bottom:6px}
.np-empty p{color:var(--np-muted);max-width:46ch;margin:0 auto 18px}
.np-switch{position:relative;display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:14px;color:var(--np-muted);user-select:none}
.np-switch input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer}
.np-switch i{width:40px;height:24px;border-radius:999px;background:var(--np-border);position:relative;transition:background .15s;flex:none}
.np-switch i::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
.np-switch input:checked+i{background:var(--np-success)}
.np-switch input:checked+i::after{transform:translateX(16px)}
.np-switch input:focus-visible+i{outline:2px solid var(--np-primary);outline-offset:2px}
.np-switch input:disabled+i{opacity:.5}
.np-field{display:grid;gap:6px;margin-bottom:18px}
.np-field:last-child{margin-bottom:0}
.np-field label,.np-label{font-weight:600;font-size:14px}
.np-help{color:var(--np-muted);font-size:13px}
.np-error{color:var(--np-danger);font-size:13px;font-weight:500}
.np-input{width:100%;border:1px solid var(--np-border);background:var(--np-surface);border-radius:8px;padding:9px 12px;min-height:40px}
.np-input:focus{outline:2px solid var(--np-primary);outline-offset:-1px;border-color:transparent}
.np-input[aria-invalid=true]{border-color:var(--np-danger)}
textarea.np-input{min-height:96px;resize:vertical}
.np-affix{display:flex;align-items:stretch;border:1px solid var(--np-border);border-radius:8px;overflow:hidden;background:var(--np-surface)}
.np-affix span{padding:9px 10px;background:var(--np-surface-2);color:var(--np-muted);border-right:1px solid var(--np-border);white-space:nowrap;max-width:50%;overflow:hidden;text-overflow:ellipsis;font-size:14px;display:flex;align-items:center}
.np-affix input{border:0;flex:1;min-width:0;padding:9px 12px;background:transparent}
.np-affix:focus-within{outline:2px solid var(--np-primary);outline-offset:-1px;border-color:transparent}
.np-affix input:focus{outline:0}
.np-color{display:flex;gap:8px;align-items:center}
.np-color input[type=color]{width:44px;height:40px;padding:2px;border:1px solid var(--np-border);border-radius:8px;background:var(--np-surface);cursor:pointer}
.np-section{margin-bottom:16px}
.np-section>h2{font-size:15px;padding:14px 20px;border-bottom:1px solid var(--np-border)}
.np-tabs{display:flex;gap:2px;border-bottom:1px solid var(--np-border);margin-bottom:20px;overflow-x:auto}
.np-tabs button{border:0;background:none;padding:10px 14px;font-weight:550;color:var(--np-muted);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap}
.np-tabs button[aria-selected=true]{color:var(--np-primary);border-bottom-color:var(--np-primary)}
.np-savebar{position:sticky;bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;margin-top:16px}
.np-note{padding:12px 14px;border-radius:10px;font-size:14px;background:var(--np-primary-soft);margin-bottom:16px}
.np-note-warn{background:var(--np-warn-soft);color:var(--np-warn)}
.np-note-danger{background:var(--np-danger-soft);color:var(--np-danger)}
.np-steps{counter-reset:s;display:grid;gap:8px;font-size:14px;margin:10px 0 0}
.np-steps li{counter-increment:s;display:flex;gap:10px}
.np-steps li::before{content:counter(s);flex:none;width:22px;height:22px;border-radius:50%;background:var(--np-primary-soft);color:var(--np-primary);font-weight:700;font-size:12px;display:grid;place-items:center}
.np-code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;background:var(--np-surface-2);border:1px solid var(--np-border);border-radius:6px;padding:1px 6px;overflow-wrap:anywhere}
.np-overlay{position:fixed;inset:0;background:rgba(10,13,20,.55);display:grid;place-items:center;padding:16px;z-index:20}
.np-modal{background:var(--np-surface);border-radius:14px;max-width:480px;width:100%;max-height:calc(100vh - 32px);overflow-y:auto;box-shadow:0 20px 50px rgba(0,0,0,.3)}
.np-modal header{padding:20px 22px 0}
.np-modal header h2{font-size:18px}
.np-modal-body{padding:12px 22px 4px;color:var(--np-muted)}
.np-modal-body strong{color:var(--np-text)}
.np-modal footer{display:flex;justify-content:flex-end;gap:10px;padding:18px 22px 20px;flex-wrap:wrap}
.np-check{display:flex;gap:10px;align-items:flex-start;font-size:14px;color:var(--np-text);margin-top:12px;cursor:pointer}
.np-check input{margin-top:3px;width:16px;height:16px;accent-color:var(--np-primary)}
.np-toasts{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);display:grid;gap:8px;z-index:30;width:min(440px,calc(100vw - 32px))}
.np-toast{padding:12px 16px;border-radius:10px;background:#111827;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.25);font-size:14px;display:flex;gap:10px;align-items:flex-start}
.np-toast-error{background:#b42318}
.np-toast button{margin-left:auto;border:0;background:none;color:inherit;cursor:pointer;opacity:.8;font-size:16px;line-height:1}
.np-center{min-height:100%;display:grid;place-items:center;padding:24px}
.np-auth{width:100%;max-width:400px;padding:28px}
.np-auth h1{font-size:21px;margin:14px 0 6px}
.np-auth p{color:var(--np-muted);margin-bottom:18px}
.np-search{width:240px;max-width:100%}
.np-dl{display:grid;grid-template-columns:minmax(110px,auto) 1fr;gap:10px 20px;font-size:14px}
.np-dl dt{color:var(--np-muted)}
.np-dl dd{overflow-wrap:anywhere}
.np-skel{height:84px;border-radius:var(--np-radius);background:linear-gradient(90deg,var(--np-surface) 25%,var(--np-surface-2) 50%,var(--np-surface) 75%);background-size:200% 100%;animation:np-sh 1.2s infinite;border:1px solid var(--np-border)}
@keyframes np-sh{to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.np-root *{animation:none!important;transition:none!important}}
`;
