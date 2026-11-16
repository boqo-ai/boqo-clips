// boqo's score bands, meter fill and axis letters (apps/web/src/components/score-grade.ts) over the scores
// around every floor: scoreBand, meterFill and bandLabel for the clip score, scoreToGrade for an axis.
import { readFileSync } from "node:fs";
import { bandLabel, meterFill, scoreBand, scoreToGrade } from "../../../web/src/components/score-grade";

const { scores } = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
console.log(
  JSON.stringify(
    scores.map((score: number) => {
      const band = scoreBand(score);
      return { score, band, label: bandLabel(band), fill: meterFill(score), grade: scoreToGrade(score) };
    }),
  ),
);
