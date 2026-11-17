"""Goldens for engine/boqo/detect-faces.mjs, written by hosted boqo's own detect_faces.py at the pin.

    ~/.boqo-mp/bin/python -I scripts/parity/py/faces_golden.py --boqo <boqo at the pin> --case <name> [--input <path>]

The Python twin of scripts/parity/golden.mjs, for the one boqo module that is Python. It imports
apps/worker/python/detect_faces.py from the given checkout (which imports mediapipe and numpy, so it needs the venv
the worker's Dockerfile describes: Python 3.11, mediapipe==0.10.18), reads tests/fixtures/parity/<name>.input.json,
runs the case's function over every entry of its "calls" list and writes the list of results to
tests/golden/<name>.json. CI never runs this: the goldens are committed.

Nothing here runs the detector. The cases that need one (process-window, analyse-shot) hand detect_faces.py a fake
whose detections are scripted in the input, and analyse-shot replaces shot_frames with a generator of blank frames,
as apps/worker/python/tests does. Inputs and outputs are numbers only.

A call that raises records {"error": <exception type>, "message": <str(exception)>}.
"""

import argparse
import json
import os
import sys
from types import SimpleNamespace

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def kp(points):
    """Keypoints as the attribute objects mediapipe hands face_geometry, or None."""
    if points is None:
        return None
    return [SimpleNamespace(x=p[0], y=p[1]) for p in points]


def fake_detection(d):
    b = d["box"]
    return SimpleNamespace(
        score=[d["score"]],
        location_data=SimpleNamespace(
            relative_bounding_box=SimpleNamespace(xmin=b[0], ymin=b[1], width=b[2], height=b[3]),
            relative_keypoints=kp(d.get("keypoints")),
        ),
    )


class ScriptedDetector:
    """Answers each process() call with the next scripted list of detections, recording the image it was given."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def process(self, image):
        self.calls.append({
            "height": int(image.shape[0]),
            "width": int(image.shape[1]),
            "contiguous": bool(image.flags["C_CONTIGUOUS"]),
            # The window's first and last pixel, so a slicing mistake shows in the golden.
            "first": [int(v) for v in image[0, 0]] if image.size else None,
            "last": [int(v) for v in image[-1, -1]] if image.size else None,
        })
        if not self.script:
            raise RuntimeError("the scripted detector ran out of answers")
        answer = self.script.pop(0)
        return SimpleNamespace(detections=None if answer is None else [fake_detection(d) for d in answer])


def pattern_frame(np, height, width):
    """A frame whose pixel (y, x) is (x % 256, y % 256, (7x + y) % 256), so any window shows where it came from."""
    ys, xs = np.mgrid[0:height, 0:width]
    return np.stack([xs % 256, ys % 256, (7 * xs + ys) % 256], axis=-1).astype(np.uint8)


def run(case, call, df, np):
    if case == "faces-face-geometry":
        return df.face_geometry(kp(call["keypoints"]), call["box"])
    if case == "faces-tile-windows":
        return [list(w) for w in df.tile_windows(call["width"], call["height"], call["maxAspect"], call["overlap"])]
    if case == "faces-to-absolute":
        return df.to_absolute(call["box"], call["x0"], call["win"], call["frameWidth"])
    if case == "faces-iou":
        return df._intersection_over_union(call["a"], call["b"])
    if case == "faces-merge-detections":
        return df.merge_detections(call["boxes"], call["iou"])
    if case == "faces-boxes-from-windows":
        windows = [tuple(w) for w in call["windows"]]
        return df.boxes_from_windows(call["results"], windows, call["frameWidth"], call["iou"])
    if case == "faces-match-box-for-point":
        return df.match_box_for_point(call["boxes"], tuple(call["point"]))
    if case == "faces-frames-with-boxes":
        return df._frames_with_boxes([tuple(p) for p in call["indexed"]])
    if case == "faces-track-face":
        entries, drops = df._track_face(call["frames"], call["startIndex"], call["seed"])
        return {"entries": entries, "drops": drops}
    if case == "faces-median-box":
        return df._median_box(call["boxes"])
    if case == "faces-sample-count":
        if "floor" in call:
            return df.sample_count(call["duration"], call["hz"], call["floor"])
        return df.sample_count(call["duration"], call["hz"])
    if case == "faces-sample-time":
        return df.sample_time(call["index"], call["requested"], call["duration"])
    if case == "faces-summarise-faces":
        return df.summarise_faces(call["frames"], call["duration"], call["requested"])
    if case == "faces-shot-frames":
        return shot_frames_case(call, df, np)
    if case == "faces-process-window":
        frame = pattern_frame(np, call["frameHeight"], call["frameWidth"])
        detector = ScriptedDetector([call["detections"]])
        found = df._process_window(frame, call["x0"], call["win"], call["scale"], detector, call["minConfidence"])
        return {"found": found, "image": detector.calls[0]}
    if case == "faces-analyse-shot":
        return analyse_shot_case(call, df, np)
    raise SystemExit(f"unknown case {case}")


def shot_frames_case(call, df, np):
    """shot_frames' ffmpeg argv and the frames it cuts from ffmpeg's stdout (a fake Popen returns
    `stdoutFrames` frames' worth of bytes, plus `extraBytes` of a partial one)."""
    seen = {}

    class FakePopen:
        def __init__(self, args, **kwargs):
            seen["argv"] = list(args)
            width = min(call["width"], df.DETECT_MAX_WIDTH)
            height = int(round(call["height"] * width / call["width"]))
            height -= height % 2
            size = width * height * 3
            payload = bytearray()
            for i in range(call["stdoutFrames"]):
                payload += bytes([i % 256]) * size
            payload += b"\x07" * call.get("extraBytes", 0)
            import io
            self.stdout = io.BytesIO(bytes(payload))
            self.returncode = call.get("returncode", 0)

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    real = df.subprocess.Popen
    df.subprocess.Popen = FakePopen
    try:
        frames = []
        try:
            # float() as detect_faces.py's main() does before shot_frames ever sees a shot's bounds.
            for index, frame in df.shot_frames(
                call["video"], float(call["start"]), float(call["end"]), call["width"], call["height"], call["count"]
            ):
                frames.append({"index": index, "shape": list(frame.shape), "first": int(frame[0, 0, 0])})
            error = None
        except RuntimeError as e:
            error = {"error": type(e).__name__, "message": str(e)}
    finally:
        df.subprocess.Popen = real
    return {"argv": seen.get("argv"), "frames": frames, "raised": error}


def analyse_shot_case(call, df, np):
    """analyse_shot over `frames` blank frames of the scaled size, the detector answering from `script` (one entry
    per window per frame, in order). Records shot_frames' arguments and every image the detector saw."""
    seen = {}

    def fake_shot_frames(video, start, end, width, height, count):
        seen["shotFrames"] = {"video": video, "start": start, "end": end, "width": width, "height": height, "count": count}
        frame = pattern_frame(np, call["scaledHeight"], call["scaledWidth"])
        for index in range(call["frames"]):
            yield index, frame

    detector = ScriptedDetector(call["script"])
    real = df.shot_frames
    df.shot_frames = fake_shot_frames
    try:
        faces = df.analyse_shot(
            "clip.mp4", detector, float(call["start"]), float(call["end"]), call["minConfidence"], call["width"], call["height"],
            call["maxAspect"], call["overlap"], call["hz"],
        )
    finally:
        df.shot_frames = real
    return {"faces": faces, "shotFrames": seen.get("shotFrames"), "detectorCalls": detector.calls,
            "unusedAnswers": len(detector.script)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--boqo", required=True)
    parser.add_argument("--case", required=True)
    parser.add_argument("--input")
    args = parser.parse_args()

    helper = os.path.join(os.path.abspath(args.boqo), "apps", "worker", "python")
    if not os.path.isfile(os.path.join(helper, "detect_faces.py")):
        raise SystemExit(f"{args.boqo} has no apps/worker/python/detect_faces.py: pass boqo at the pin")
    # No __pycache__ left in the boqo checkout.
    sys.dont_write_bytecode = True
    sys.path.insert(0, helper)
    import numpy as np
    import detect_faces as df

    path = args.input or os.path.join(ROOT, "tests", "fixtures", "parity", f"{args.case}.input.json")
    with open(path, encoding="utf-8") as fh:
        calls = json.load(fh)["calls"]

    results = []
    for call in calls:
        try:
            results.append(run(args.case, call, df, np))
        except (ValueError, RuntimeError) as e:
            results.append({"error": type(e).__name__, "message": str(e)})

    out = os.path.join(ROOT, "tests", "golden", f"{args.case}.json")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(results, indent=2, allow_nan=False) + "\n")
    print(out)


if __name__ == "__main__":
    main()
