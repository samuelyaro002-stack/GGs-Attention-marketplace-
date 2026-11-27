import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const source = path.resolve("attached_assets/gg_walkthrough_unedited_1791458688830.mp4");
const voice = path.resolve("deliverables/ggs-celo-voiceover.mp3");
const temporary = "/tmp/ggs-celo-edit";
const output = path.resolve("deliverables/ggs-celo-pitch-walkthrough.mp4");
const font = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
mkdirSync(temporary, { recursive: true });
mkdirSync(path.dirname(output), { recursive: true });

const box = (x, y, w, h, color = "0xF7F6F0") =>
  `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${color}:t=fill`;
const identity = box(1430, 0, 490, 76);
const segments = [
  { name: "opening", start: 0, take: 19.2, duration: 19.2,
    label: "GG ATTENTION MARKETPLACE  |  Creator campaign walkthrough", masks: [] },
  { name: "campaigns", start: 78, take: 0.05, duration: 23.57,
    label: "CAMPAIGN BOARD  |  Briefs, reward assets and funding status", masks: [identity] },
  { name: "privy", start: 29, take: 7, duration: 15.74,
    label: "PRIVY AUTHENTICATION  |  Sign-in only", masks: [] },
  { name: "submission", start: 202, take: 14, duration: 17,
    label: "CREATOR SUBMISSION  |  Personal account and wallet values hidden",
    masks: [identity, box(210, 435, 1025, 410)] },
  { name: "xp", start: 235, take: 0.05, duration: 9.32,
    label: "DEMO XP  |  Social API verification is not connected",
    masks: [identity, box(210, 300, 1025, 430), box(1260, 607, 465, 105)] },
  { name: "leaderboard", start: 248, take: 0.05, duration: 15.52,
    label: "LEADERBOARD  |  Recorded demo participation, not a token payout",
    masks: [identity, box(285, 607, 365, 106)] },
  { name: "daily-g", start: 263, take: 0.05, duration: 15.44,
    label: "DAILY G$  |  A separate GoodDollar experience",
    masks: [identity, box(395, 620, 380, 110), box(1140, 165, 440, 380)] },
  { name: "celo", start: 108, take: 0.05, duration: 17.39,
    label: "CELO SEPOLIA TESTNET  |  Setup shown; no completed funding or payout",
    masks: [identity, box(180, 780, 1060, 166)] },
  { name: "closing", start: 0, take: 16.82, duration: 16.82,
    label: "GG ATTENTION MARKETPLACE  |  Product walkthrough for Celo", masks: [] },
];

function run(args) {
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args],
    { stdio: "inherit" });
}

for (const [index, segment] of segments.entries()) {
  console.log(`Rendering ${segment.name} (${segment.duration}s)`);
  const filters = [
    `trim=duration=${segment.take}`, "setpts=PTS-STARTPTS",
    `tpad=stop_mode=clone:stop_duration=${segment.duration}`,
    ...segment.masks,
    "pad=1920:1080:0:67:color=0x171B26",
    `drawtext=fontfile=${font}:text='GG ATTENTION MARKETPLACE':x=48:y=22:fontsize=23:fontcolor=0xF5F3ED`,
    `drawtext=fontfile=${font}:text='${segment.label}':x=48:y=1033:fontsize=25:fontcolor=0xF5F3ED`,
  ];
  if (index === 0) filters.push("fade=t=in:st=0:d=0.4");
  if (index === segments.length - 1)
    filters.push(`fade=t=out:st=${segment.duration - 0.6}:d=0.6`);
  const filename = path.join(temporary, `${index}.mp4`);
  run(["-ss", String(segment.start), "-i", source,
    "-vf", filters.join(","),
    "-af", `atrim=duration=${segment.duration},asetpts=PTS-STARTPTS,apad`,
    "-t", String(segment.duration), "-r", "30", "-c:v", "libx264",
    "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-threads", "2", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-map_metadata", "-1", "-map_chapters", "-1", filename]);
}

const list = path.join(temporary, "concat.txt");
writeFileSync(list, segments.map((_, index) =>
  `file '${path.join(temporary, `${index}.mp4`)}'`).join("\n"));
const picture = path.join(temporary, "picture.mp4");
run(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy",
  "-map_metadata", "-1", picture]);

// Extend pauses only within detected silence, keeping every spoken word.
const boundaries = [0, 10.2, 28.77, 39.51, 60.83, 71.35, 81.79, 94.18, 106.893061];
const parts = [
  "[1:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=8" +
    boundaries.slice(0, -1).map((_, index) => `[raw${index}]`).join(""),
  "anullsrc=r=48000:cl=stereo,atrim=duration=4[lead]",
];
for (let index = 0; index < 8; index++) {
  parts.push(`[raw${index}]atrim=start=${boundaries[index]}:end=${boundaries[index + 1]},` +
    "asetpts=PTS-STARTPTS" + (index < 7 ? ",apad=pad_dur=5" : "") + `[p${index}]`);
}
parts.push("[lead]" + boundaries.slice(0, -1).map((_, index) => `[p${index}]`).join("") +
  "concat=n=9:v=0:a=1,apad=whole_dur=150,atrim=duration=150," +
  "loudnorm=I=-17:TP=-2:LRA=8[vo]");
parts.push("[0:a]volume=0.10[background]");
parts.push("[background][vo]amix=inputs=2:duration=first:normalize=0," +
  "alimiter=limit=0.97:level=0,afade=t=out:st=149:d=1[audio]");
console.log("Mixing narration with the quiet original recording audio");
run(["-i", picture, "-i", voice, "-filter_complex", parts.join(";"),
  "-map", "0:v:0", "-map", "[audio]", "-c:v", "copy",
  "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", "150",
  "-map_metadata", "-1", "-map_chapters", "-1", "-movflags", "+faststart", output]);
console.log(`Finished: ${output}`);
