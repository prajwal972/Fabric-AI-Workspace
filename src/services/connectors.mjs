import {
  networkFetch,
  boundedText,
  privateAddress,
} from "../security/network.mjs";
import dns from "node:dns/promises";
import net from "node:net";
export function connectorService({ box, runTool }) {
  const clean = (v, n = 10000) =>
      String(v ?? "")
        .replace(/\0/g, "")
        .slice(0, n),
    dec = (v) => box.decrypt(v),
    fetch = (url, options) => networkFetch(url, options);
  function remoteUrl(raw) {
    const u = new URL(raw);
    if (
      !["http:", "https:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      (net.isIP(u.hostname) && privateAddress(u.hostname))
    )
      throw new Error("Unsafe connector endpoint");
    return u.toString().replace(/\/$/, "");
  }
  async function assertEndpointSafe(url) {
    remoteUrl(url);
    return url;
  }
  const pc = (
    id,
    name,
    category,
    description,
    icon,
    defaultBaseUrl = "",
    features = [],
    internal = false,
  ) => ({
    id,
    name,
    category,
    description,
    icon,
    defaultBaseUrl,
    features,
    internal,
  });
  const OAUTH_PLUGIN_MAP = {
    notion: "notion",
    slack: "slack",
    github: "github",
    gmail: "google",
    "google-calendar": "google",
    "google-drive": "google",
    bigquery: "google",
    outlook: "microsoft",
    "microsoft-teams": "microsoft",
    onedrive: "microsoft",
    "power-bi": "microsoft",
  };
  const OAUTH_DEFS = {
    github: {
      authorize: "https://github.com/login/oauth/authorize",
      token: "https://github.com/login/oauth/access_token",
      scope: "read:user user:email",
    },
    slack: {
      authorize:
        "https" + String.fromCharCode(58) + "//slack.com/oauth/v2/authorize",
      token:
        "https" + String.fromCharCode(58) + "//slack.com/api/oauth.v2.access",
      scope: "channels:read users:read",
    },
    google: {
      authorize: "https://accounts.google.com/o/oauth2/v2/auth",
      token: "https://oauth2.googleapis.com/token",
      scope:
        "openid email https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly",
    },
    microsoft: {
      authorize:
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      scope: "offline_access User.Read Mail.Read Files.Read Calendars.Read",
    },
    notion: {
      authorize: "https://api.notion.com/v1/oauth/authorize",
      token: "https://api.notion.com/v1/oauth/token",
      scope: "",
    },
  };
  function oauthEnvironment(provider) {
    const key = provider.toUpperCase();
    return [
      "FABRIC_OAUTH_" + key + "_CLIENT_ID",
      "FABRIC_OAUTH_" + key + "_CLIENT_SECRET",
    ];
  }
  function oauthConfig(provider) {
    if (!provider) return null;
    const d = OAUTH_DEFS[provider],
      keys = oauthEnvironment(provider);
    return d && process.env[keys[0]] && process.env[keys[1]]
      ? {
          ...d,
          clientId: process.env[keys[0]],
          clientSecret: process.env[keys[1]],
          keys,
        }
      : null;
  }
  function publicOrigin(req) {
    const raw =
      process.env.FABRIC_PUBLIC_URL ||
      (process.env.NODE_ENV === "production" ? "https" : "http") +
        "://" +
        req.headers.host;
    const u = new URL(raw);
    return u.origin;
  }
  async function exchangeOAuth(provider, code, redirectUri, config, verifier) {
    const form = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
      headers = {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      };
    if (provider === "notion")
      headers.authorization =
        "Basic " +
        Buffer.from(config.clientId + ":" + config.clientSecret).toString(
          "base64",
        );
    if (verifier) form.set("code_verifier", verifier);
    const r = await fetch(config.token, {
        method: "POST",
        headers,
        body: form,
        signal: AbortSignal.timeout(30000),
      }),
      text = await r.text();
    let j = {};
    try {
      j = JSON.parse(text);
    } catch {}
    if (!r.ok || j.error) throw Error("Official OAuth token exchange failed.");
    const token = j.access_token || j.authed_user?.access_token;
    if (!token) throw Error("Official OAuth provider returned no access token");
    return token;
  }
  const PLUGIN_CHAT_ACTIONS = {
    github: { method: "GET", path: "/user/repos?per_page=10" },
    notion: { method: "POST", path: "/search", body: "{}" },
    slack: { method: "GET", path: "/conversations.list?limit=20" },
    gmail: { method: "GET", path: "/users/me/messages?maxResults=10" },
    "google-drive": { method: "GET", path: "/files?pageSize=10" },
    "google-calendar": {
      method: "GET",
      path: "/calendars/primary/events?maxResults=10&singleEvents=true",
    },
    outlook: { method: "GET", path: "/me/messages?$top=10" },
    onedrive: { method: "GET", path: "/me/drive/root/children?$top=10" },
  };
  const PLUGIN_CATALOG = [
    pc(
      "fabric-utils",
      "Fabric Utilities",
      "Core",
      "Safe calculator and clock actions built into Fabric.",
      "F",
      "",
      "Calculate,Time".split(","),
      true,
    ),
    pc(
      "webhook",
      "Universal Webhook",
      "Automation",
      "Connect any service that exposes a public HTTPS webhook.",
      "↗",
      "",
      "Webhook,REST".split(","),
    ),
    pc(
      "rest-api",
      "REST API",
      "Automation",
      "Call any authenticated public REST API without custom code.",
      "API",
      "",
      "GET,POST".split(","),
    ),
    pc(
      "rss",
      "RSS Feed",
      "Automation",
      "Read and route updates from RSS and Atom feeds.",
      "RSS",
      "",
      "Feeds,Monitor".split(","),
    ),
    pc(
      "notion",
      "Notion",
      "Productivity",
      "Create, read, and organize pages and databases.",
      "N",
      "https://api.notion.com/v1",
      ["Pages", "Databases"],
    ),
    pc(
      "slack",
      "Slack",
      "Communication",
      "Send messages and automate team notifications.",
      "S",
      "https" + String.fromCharCode(58) + "//slack.com/api",
    ),
    pc(
      "microsoft-teams",
      "Microsoft Teams",
      "Communication",
      "Post messages and coordinate Microsoft 365 work.",
      "T",
      "https://graph.microsoft.com/v1.0",
      ["Messages", "Teams"],
    ),
    pc(
      "discord",
      "Discord",
      "Communication",
      "Automate community messages and events.",
      "D",
      "https://discord.com/api/v10",
      ["Messages", "Webhooks"],
    ),
    pc(
      "telegram",
      "Telegram",
      "Communication",
      "Build notification and bot workflows.",
      "TG",
      "https://api.telegram.org",
      ["Bots", "Messages"],
    ),
    pc(
      "twilio",
      "Twilio",
      "Communication",
      "Send SMS and trigger communication flows.",
      "TW",
      "https://api.twilio.com/2010-04-01",
      ["SMS", "Voice"],
    ),
    pc(
      "sendgrid",
      "SendGrid",
      "Communication",
      "Send transactional email from automations.",
      "SG",
      "https://api.sendgrid.com/v3",
      ["Email", "Templates"],
    ),
    pc(
      "gmail",
      "Gmail",
      "Google",
      "Read and send mail through Google APIs.",
      "G",
      "https://gmail.googleapis.com/gmail/v1",
      ["Email", "Labels"],
    ),
    pc(
      "google-calendar",
      "Google Calendar",
      "Google",
      "Create events and coordinate schedules.",
      "31",
      "https://www.googleapis.com/calendar/v3",
      ["Events", "Schedules"],
    ),
    pc(
      "google-drive",
      "Google Drive",
      "Storage",
      "Find and manage files in Google Drive.",
      "GD",
      "https://www.googleapis.com/drive/v3",
      ["Files", "Folders"],
    ),
    pc(
      "bigquery",
      "Google BigQuery",
      "Data",
      "Query cloud datasets for automated analysis.",
      "BQ",
      "https://bigquery.googleapis.com/bigquery/v2",
      ["SQL", "Warehouse"],
    ),
    pc(
      "outlook",
      "Microsoft Outlook",
      "Microsoft",
      "Automate Outlook mail with Microsoft Graph.",
      "O",
      "https://graph.microsoft.com/v1.0",
      ["Email", "Folders"],
    ),
    pc(
      "onedrive",
      "OneDrive",
      "Storage",
      "Move and organize Microsoft cloud files.",
      "OD",
      "https://graph.microsoft.com/v1.0",
      ["Files", "Folders"],
    ),
    pc(
      "dropbox",
      "Dropbox",
      "Storage",
      "Sync files and content into Fabric workflows.",
      "DB",
      "https://api.dropboxapi.com/2",
      ["Files", "Folders"],
    ),
    pc(
      "box",
      "Box",
      "Storage",
      "Connect secure enterprise content workflows.",
      "BX",
      "https://api.box.com/2.0",
      ["Files", "Content"],
    ),
    pc(
      "github",
      "GitHub",
      "Development",
      "Automate issues, repositories, releases, and code tasks.",
      "GH",
      "https://api.github.com",
      ["Repos", "Issues"],
    ),
    pc(
      "gitlab",
      "GitLab",
      "Development",
      "Connect projects, merge requests, and pipelines.",
      "GL",
      "https://gitlab.com/api/v4",
      ["Projects", "CI"],
    ),
    pc(
      "jira",
      "Jira",
      "Development",
      "Create and update issues in software workflows.",
      "J",
      "https://api.atlassian.com",
      ["Issues", "Projects"],
    ),
    pc(
      "linear",
      "Linear",
      "Development",
      "Automate issues, projects, and engineering operations.",
      "L",
      "https://api.linear.app",
      ["Issues", "Projects"],
    ),
    pc(
      "asana",
      "Asana",
      "Productivity",
      "Coordinate tasks, projects, and team operations.",
      "A",
      "https://app.asana.com/api/1.0",
      ["Tasks", "Projects"],
    ),
    pc(
      "trello",
      "Trello",
      "Productivity",
      "Move cards and automate boards.",
      "TR",
      "https://api.trello.com/1",
      ["Cards", "Boards"],
    ),
    pc(
      "airtable",
      "Airtable",
      "Data",
      "Use Airtable bases as flexible workflow data.",
      "AT",
      "https://api.airtable.com/v0",
      ["Bases", "Records"],
    ),
    pc(
      "monday",
      "monday.com",
      "Productivity",
      "Automate boards and work management.",
      "M",
      "https://api.monday.com/v2",
      ["Boards", "Items"],
    ),
    pc(
      "hubspot",
      "HubSpot",
      "CRM",
      "Connect contacts, companies, and deals.",
      "H",
      "https://api.hubapi.com",
      ["Contacts", "Deals"],
    ),
    pc(
      "salesforce",
      "Salesforce",
      "CRM",
      "Automate CRM records and customer operations.",
      "SF",
      "https://login.salesforce.com",
      ["CRM", "Records"],
    ),
    pc(
      "stripe",
      "Stripe",
      "Commerce",
      "Connect payments, customers, and billing events.",
      "ST",
      "https://api.stripe.com/v1",
      ["Payments", "Billing"],
    ),
    pc(
      "shopify",
      "Shopify",
      "Commerce",
      "Automate products, orders, and customers.",
      "SH",
      "",
      ["Orders", "Products"],
    ),
    pc(
      "woocommerce",
      "WooCommerce",
      "Commerce",
      "Connect orders and products over the WooCommerce API.",
      "WC",
      "",
      ["Orders", "Products"],
    ),
    pc(
      "postgresql",
      "PostgreSQL",
      "Data",
      "Connect through a secure public API gateway to PostgreSQL.",
      "PG",
      "",
      "SQL,Database".split(","),
    ),
    pc(
      "mysql",
      "MySQL",
      "Data",
      "Connect through a secure public API gateway to MySQL.",
      "MY",
      "",
      "SQL,Database".split(","),
    ),
    pc(
      "mongodb",
      "MongoDB Atlas",
      "Data",
      "Use the Atlas Data API in workflows.",
      "MO",
      "https://data.mongodb-api.com/app",
      ["Documents", "Data API"],
    ),
    pc(
      "snowflake",
      "Snowflake",
      "Data",
      "Connect warehouse operations through a public API.",
      "SN",
      "",
      ["Warehouse", "SQL"],
    ),
    pc(
      "power-bi",
      "Power BI",
      "Analytics",
      "Refresh datasets and automate BI operations.",
      "BI",
      "https://api.powerbi.com/v1.0/myorg",
      ["Datasets", "Reports"],
    ),
    pc(
      "tableau",
      "Tableau",
      "Analytics",
      "Connect views, workbooks, and analytics jobs.",
      "TB",
      "",
      ["Workbooks", "Views"],
    ),
    pc(
      "openai",
      "OpenAI",
      "AI",
      "Use OpenAI APIs as workflow actions.",
      "AI",
      "https://api.openai.com/v1",
      ["Models", "Responses"],
    ),
    pc(
      "anthropic",
      "Anthropic",
      "AI",
      "Use Claude APIs inside multi-step automations.",
      "AN",
      "https://api.anthropic.com/v1",
      ["Claude", "Messages"],
    ),
    pc(
      "gemini",
      "Google Gemini",
      "AI",
      "Use Gemini generation APIs in a workflow.",
      "GM",
      "https://generativelanguage.googleapis.com/v1beta",
      ["Gemini", "Generate"],
    ),
    pc(
      "ollama",
      "Ollama Gateway",
      "AI",
      "Connect a publicly secured Ollama-compatible gateway.",
      "OL",
      "",
      ["Local AI", "Models"],
    ),
    pc(
      "zendesk",
      "Zendesk",
      "Support",
      "Automate tickets and customer support operations.",
      "Z",
      "",
      ["Tickets", "Users"],
    ),
    pc(
      "intercom",
      "Intercom",
      "Support",
      "Connect conversations, contacts, and support actions.",
      "I",
      "https://api.intercom.io",
      ["Conversations", "Contacts"],
    ),
  ];
  const publicPlugin = (x) => ({
    id: x.id,
    pluginId: x.pluginId,
    name: x.name,
    baseUrl: x.baseUrl,
    authScheme: x.authScheme,
    enabled: x.enabled,
    hasCredential: !!x.credential,
    createdAt: x.createdAt,
  });
  async function executePluginConnection(
    x,
    input = {},
    config = {},
    testing = false,
  ) {
    const def = PLUGIN_CATALOG.find((p) => p.id === x.pluginId);
    if (!def) throw Error("Plugin template unavailable");
    if (def.internal) {
      const op = config.operation || input.operation || "clock";
      return op === "calculator"
        ? runTool("calculator", {
            expression: input.expression || config.expression || "0",
          })
        : runTool("clock", {});
    }
    if (!x.baseUrl) throw Error("Plugin endpoint is not configured");
    const declared = PLUGIN_CHAT_ACTIONS[x.pluginId];
    if (!declared)
      throw Error("This connector has no approved executable action");
    const requested = testing ? declared : config,
      method = String(requested.method || "GET").toUpperCase(),
      raw = String(requested.path || "");
    if (method !== declared.method || raw !== declared.path)
      throw Error("Plugin action is not allowlisted");
    const base = new URL(x.baseUrl.endsWith("/") ? x.baseUrl : x.baseUrl + "/"),
      url = new URL(raw, base);
    if (url.origin !== base.origin)
      throw Error("Plugin path must stay on the configured origin");
    const target = remoteUrl(url.toString());
    await assertEndpointSafe(target);
    const headers = { accept: "application/json,text/plain" };
    if (x.credential) {
      const secret = dec(x.credential);
      if (x.authScheme === "x-api-key") headers["x-api-key"] = secret;
      else if (x.authScheme !== "none")
        headers.authorization = "Bearer " + secret;
    }
    let requestBody;
    if (method === "POST") {
      headers["content-type"] = "application/json";
      let template = String(requested.body || "");
      if (template) {
        template = template.replaceAll(
          "{{input}}",
          String(input?.value ?? input ?? ""),
        );
        try {
          requestBody = JSON.stringify(JSON.parse(template));
        } catch {
          requestBody = JSON.stringify({ input: template });
        }
      } else requestBody = JSON.stringify({ input });
    }
    const r = await fetch(target, {
        method,
        headers,
        body: requestBody,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      }),
      text = await boundedText(r, 500000);
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {}
    if (r.status >= 500)
      throw Error("Plugin service failed with HTTP " + r.status);
    return { ok: r.ok, status: r.status, data };
  }

  return {
    catalog: PLUGIN_CATALOG,
    oauthMap: OAUTH_PLUGIN_MAP,
    oauthConfig,
    exchangeOAuth,
    actions: PLUGIN_CHAT_ACTIONS,
    execute: executePluginConnection,
    publicPlugin,
  };
}
