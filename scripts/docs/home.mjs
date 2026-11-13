import { GUIDES, REPO_URL, agentField, icons } from './build.mjs';

const AGENT_CARDS = {
  integrate: { title: 'Add it to a Next.js site', text: 'Dashboard, API route, plugin pages and layout slots, wired into an existing App Router project.' },
  build: { title: 'Build a plugin', text: 'A plugin repository from scratch: manifest, components, server code, and what to put in CLAUDE.md.' },
};

const ADDS = [
  ['Pages', 'Server-rendered, with their own title, description, canonical link and structured data.'],
  ['HTTP endpoints', 'Form posts, webhooks and anything else, on web-standard Request and Response.'],
  ['Stored data', 'A private key-value store per plugin, kept in the site’s own database.'],
  ['Layout widgets', 'A floating button, a banner or a header action, in places the site marks.'],
  ['A settings form', 'Generated from the manifest, written for a non-technical owner.'],
  ['Dashboard screens', 'Tabs of the plugin’s own, such as an inbox, next to its settings.'],
];

/** The landing page. Its main call to action is the address of each guide's agent version. */
export function homeBody({ r }) {
  const cards = GUIDES.map((g) => {
    const card = AGENT_CARDS[g.slug];
    return `<article class="agent-card">
        <div>
          <h3>${card.title}</h3>
          <p>${card.text}</p>
          <a class="read" href="${r}${g.slug}/">Read it yourself ${icons.arrow}</a>
        </div>
        <div>
          ${agentField({ r, file: `${g.slug}.md`, label: `the ${g.nav.toLowerCase()} guide`, prompt: g.prompt })}
        </div>
      </article>`;
  }).join('\n      ');

  return `<main id="content">
  <section class="hero">
    <div class="wrap">
      <p class="kicker">WordPress-style plugins for Next.js</p>
      <h1>Plugins for Next.js, installed from a dashboard.</h1>
      <p class="hero-lead">Add one package to a site. Its owner then installs plugins from GitHub repositories: pages, endpoints, widgets and settings, with no rebuild and no redeploy.</p>

      <div class="agents" id="agents">
        <h2>Hand the instructions to your coding agent</h2>
        <p class="agents-lead">Each address is a complete guide in Markdown, written to be followed step by step. Paste it into Claude Code, Cursor or any agent that can read a URL.</p>
        <div class="agent-cards">
      ${cards}
        </div>
      </div>
    </div>
  </section>

  <section class="band">
    <div class="wrap split">
      <div>
        <h2>How it works</h2>
        <ol class="steps">
          <li><strong>A developer adds the package, once.</strong> Four small files and an optional slot in the layout. <a href="${r}integrate/">Integration guide</a></li>
          <li><strong>The owner connects a GitHub repository</strong> in the dashboard and installs a plugin from it. It is live about a second later.</li>
          <li><strong>Plugin authors push a new build.</strong> The dashboard offers it as an update, and the owner’s settings carry over. <a href="${r}build/">Plugin guide</a></li>
        </ol>
      </div>
      <figure class="shot">
        <img src="${r}assets/dashboard.png" width="960" height="470" alt="The plugin dashboard with two plugins installed, each with a settings button and an on/off switch." loading="lazy">
      </figure>
    </div>
  </section>

  <section class="band band-plain">
    <div class="wrap">
      <h2>What a plugin can add</h2>
      <ul class="adds">
        ${ADDS.map(([title, text]) => `<li><strong>${title}</strong><span>${text}</span></li>`).join('\n        ')}
      </ul>
    </div>
  </section>

  <section class="band">
    <div class="wrap">
      <h2>Know this before you rely on it</h2>
      <ul class="caveats">
        <li><strong>Plugins are trusted code.</strong> A plugin’s server code runs inside the site and can do anything the site can. There is no sandbox yet.</li>
        <li><strong>Node.js runtime only.</strong> It does not run on the Edge runtime or on Cloudflare Workers.</li>
        <li><strong>Cache Components is not supported yet.</strong> With <code>cacheComponents: true</code> the build fails.</li>
      </ul>
      <p class="more"><a href="${r}integrate/#limits">All limits</a> · <a href="${REPO_URL}/blob/main/docs/research.md">Why it is built this way</a></p>
    </div>
  </section>
</main>`;
}
