/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require("node:child_process");

const TRANSIENT_PATTERNS = [
  /Connection terminated unexpectedly/i,
  /NeonDbError/i,
  /fetch failed/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /WebSocket/i,
];

function parseArgs(argv) {
  const separator = argv.indexOf("--");
  if (separator === -1) throw new Error("Usage: node scripts/run-with-retry.cjs --retries <count> -- <command> [...args]");

  const wrapperArgs = argv.slice(0, separator);
  const commandArgs = argv.slice(separator + 1);
  const retriesIndex = wrapperArgs.indexOf("--retries");
  const retries = retriesIndex === -1 ? 1 : Number(wrapperArgs[retriesIndex + 1]);

  if (!Number.isInteger(retries) || retries < 0) throw new Error("--retries must be a non-negative integer.");
  if (commandArgs.length === 0) throw new Error("Command is required after --.");

  return { retries, command: commandArgs[0], args: commandArgs.slice(1) };
}

function isTransient(output) {
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(output));
}

function run(command, args) {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    function collect(chunk, stream) {
      const text = chunk.toString();
      output += text;
      if (output.length > 20000) output = output.slice(-20000);
      stream.write(text);
    }

    child.stdout.on("data", (chunk) => collect(chunk, process.stdout));
    child.stderr.on("data", (chunk) => collect(chunk, process.stderr));
    child.on("close", (code, signal) => resolve({ code: code ?? 1, signal, output }));
    child.on("error", (error) => {
      const message = `${error.stack || error}\n`;
      output += message;
      process.stderr.write(message);
      resolve({ code: 1, signal: null, output });
    });
  });
}

(async () => {
  const { retries, command, args } = parseArgs(process.argv.slice(2));

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const result = await run(command, args);
    if (result.code === 0) return;

    const canRetry = attempt < retries && isTransient(result.output);
    if (!canRetry) {
      process.exitCode = result.code;
      return;
    }

    console.error(`Transient database failure detected. Retrying ${command} ${args.join(" ")} (${attempt + 1}/${retries})...`);
  }
})().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});

