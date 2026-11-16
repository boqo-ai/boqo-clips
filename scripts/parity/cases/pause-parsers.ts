// boqo's pause detector arguments and parsers (pauses.ts): meanVolumeArgs, silenceDetectArgs,
// parseMeanVolumeDb and parseQuietRuns. -Infinity prints as null in JSON.
import { readFileSync } from "node:fs";
import { meanVolumeArgs, parseMeanVolumeDb, parseQuietRuns, silenceDetectArgs } from "../render/pauses";

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const { meanVolume, quietRuns, args } = input.cases;
console.log(
  JSON.stringify({
    meanVolume: meanVolume.map((c: any) => parseMeanVolumeDb(c.stderr)),
    quietRuns: quietRuns.map((c: any) => parseQuietRuns(c.stderr, c.windowDurationSec)),
    meanVolumeArgs: meanVolumeArgs(args.path),
    silenceDetectArgs: silenceDetectArgs(args.path, args.noiseDb, args.minSec),
  }),
);
