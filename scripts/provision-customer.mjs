#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";

const edgeFunctions = [
  "action-token-consume",
  "cron-drain-notifications",
  "cron-inspection-reminders",
  "cron-send-check-ins",
  "cron-weekly-report",
  "expenses",
  "health",
  "iframe-session",
  "inbound-sms",
  "job-states",
  "jobs",
  "logout",
  "me",
  "search",
  "settings",
  "users",
];

function usage() {
  console.log(`Usage:
  npm.cmd run provision:customer -- --config path/to/customer.json
  npm.cmd run provision:customer -- --config path/to/customer.json --apply --secrets-env-file path/to/customer.env

Dry-run is the default. --apply requires:
  - config.supabaseProjectRef
  - SUPABASE_DB_PASSWORD in your shell
  - --secrets-env-file, unless --skip-secrets is passed`);
}

function parseArgs(argv) {
  const args = { apply: false, skipSecrets: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--skip-secrets") args.skipSecrets = true;
    else if (arg === "--config") args.configPath = argv[++i];
    else if (arg === "--secrets-env-file") args.secretsEnvFile = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function readConfig(configPath) {
  const fullPath = path.resolve(repoRoot, configPath);
  if (!existsSync(fullPath)) throw new Error(`Config file not found: ${fullPath}`);
  return JSON.parse(readFileSync(fullPath, "utf8"));
}

function requireString(config, key) {
  const value = config[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required config value: ${key}`);
  }
  return value.trim();
}

function optionalString(config, key, fallback = "") {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function buildCompanySql(config) {
  return `WITH updated_location AS (
  UPDATE public.locations
  SET
    uptiq_company_id = ${sqlString(config.uptiqCompanyId)},
    uptiq_location_id = ${sqlString(config.uptiqLocationId)},
    company_name = ${sqlString(config.companyName)},
    timezone = ${sqlString(config.timezone)}
  WHERE uptiq_location_id IN ('DEMO_LOCATION', ${sqlString(config.uptiqLocationId)})
  RETURNING id
)
INSERT INTO public.company_settings (location_id, supply_house_pickup_time)
SELECT id, '7AM'
FROM updated_location
ON CONFLICT (location_id) DO NOTHING;`;
}

function commandText(command, args) {
  return [command, ...args].join(" ");
}

function run(command, args, options = {}) {
  const displayArgs = options.redact ? args.map((arg) => (options.redact.includes(arg) ? "********" : arg)) : args;
  console.log(`\n> ${commandText(command, displayArgs)}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}: ${commandText(command, displayArgs)}`);
  }
}

function printPlan(config, secretsEnvFile) {
  const appUrl = config.appBaseUrl.replace(/\/$/, "");
  const menuLink = `${appUrl}?location_id={{location.id}}&user_email={{user.email}}&user_name={{user.name}}&phone={{user.phone}}`;
  console.log("\nCustomer onboarding dry run");
  console.log(`Company: ${config.companyName}`);
  console.log(`Uptiq location: ${config.uptiqLocationId}`);
  console.log(`Supabase project: ${config.supabaseProjectRef || "(create new project first)"}`);

  if (!config.supabaseProjectRef) {
    const orgId = optionalString(config, "supabaseOrgId", "<SUPABASE_ORG_ID>");
    const region = optionalString(config, "supabaseRegion", "us-west-2");
    const size = optionalString(config, "supabaseSize", "nano");
    console.log("\nCreate project command:");
    console.log(commandText(npxBin, [
      "supabase", "projects", "create", `"${config.companyName}"`,
      "--org-id", orgId,
      "--db-password", "<SUPABASE_DB_PASSWORD>",
      "--region", region,
      "--size", size,
    ]));
  }

  if (config.supabaseProjectRef) {
    console.log("\nProvision commands:");
    console.log(commandText(npxBin, ["supabase", "link", "--project-ref", config.supabaseProjectRef, "--password", "<SUPABASE_DB_PASSWORD>"]));
    console.log(commandText(npxBin, ["supabase", "db", "push", "--linked", "--include-all", "--password", "<SUPABASE_DB_PASSWORD>"]));
    console.log(commandText(npxBin, ["supabase", "db", "query", "--linked", "--file", "supabase/.temp/provision-customer.sql"]));
    if (secretsEnvFile) {
      console.log(commandText(npxBin, ["supabase", "secrets", "set", "--project-ref", config.supabaseProjectRef, "--env-file", secretsEnvFile]));
    }
    console.log(commandText(npxBin, ["supabase", "functions", "deploy", ...edgeFunctions, "--project-ref", config.supabaseProjectRef, "--no-verify-jwt", "--use-api", "--jobs", "4"]));
    console.log(commandText(npxBin, ["supabase", "functions", "list", "--project-ref", config.supabaseProjectRef]));
  }

  console.log("\nCompany SQL:");
  console.log(buildCompanySql(config));
  console.log("\nUptiq custom menu link:");
  console.log(menuLink);
}

function normalizeConfig(raw) {
  return {
    companyName: requireString(raw, "companyName"),
    uptiqCompanyId: requireString(raw, "uptiqCompanyId"),
    uptiqLocationId: requireString(raw, "uptiqLocationId"),
    ownerEmail: requireString(raw, "ownerEmail"),
    timezone: requireString(raw, "timezone"),
    appBaseUrl: requireString(raw, "appBaseUrl"),
    supabaseProjectRef: optionalString(raw, "supabaseProjectRef"),
    supabaseOrgId: optionalString(raw, "supabaseOrgId"),
    supabaseRegion: optionalString(raw, "supabaseRegion", "us-west-2"),
    supabaseSize: optionalString(raw, "supabaseSize", "nano"),
  };
}

function applyProvisioning(config, secretsEnvFile, skipSecrets) {
  if (!config.supabaseProjectRef) throw new Error("--apply requires config.supabaseProjectRef");
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;
  if (!dbPassword) throw new Error("--apply requires SUPABASE_DB_PASSWORD in your shell");
  if (!skipSecrets && !secretsEnvFile) throw new Error("--apply requires --secrets-env-file, unless --skip-secrets is passed");

  const tempDir = path.join(repoRoot, "supabase", ".temp");
  mkdirSync(tempDir, { recursive: true });
  const sqlPath = path.join(tempDir, `provision-${slugify(config.companyName)}.sql`);
  writeFileSync(sqlPath, buildCompanySql(config), "utf8");

  run(npxBin, ["supabase", "link", "--project-ref", config.supabaseProjectRef, "--password", dbPassword], { redact: [dbPassword] });
  run(npxBin, ["supabase", "db", "push", "--linked", "--include-all", "--password", dbPassword], { redact: [dbPassword] });
  run(npxBin, ["supabase", "db", "query", "--linked", "--file", sqlPath]);

  if (!skipSecrets) {
    run(npxBin, ["supabase", "secrets", "set", "--project-ref", config.supabaseProjectRef, "--env-file", path.resolve(repoRoot, secretsEnvFile)]);
  }

  run(npxBin, [
    "supabase", "functions", "deploy",
    ...edgeFunctions,
    "--project-ref", config.supabaseProjectRef,
    "--no-verify-jwt",
    "--use-api",
    "--jobs", "4",
  ]);
  run(npxBin, ["supabase", "functions", "list", "--project-ref", config.supabaseProjectRef]);
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.configPath) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const config = normalizeConfig(readConfig(args.configPath));
  const secretsEnvFile = args.secretsEnvFile || "";
  if (args.apply) {
    applyProvisioning(config, secretsEnvFile, args.skipSecrets);
  } else {
    printPlan(config, secretsEnvFile);
  }
} catch (error) {
  console.error(`\nProvisioning failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
