import { runCutoverCli } from "../deploy/cli";

process.exitCode = await runCutoverCli(process.argv.slice(2));
