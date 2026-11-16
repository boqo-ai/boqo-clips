"""Runs hosted boqo's face detector (mediapipe, through detect_faces.py at the pin) over a directory of PNG frames.

    ~/.boqo-mp/bin/python -I scripts/parity/py/mp_detect.py --boqo <boqo at the pin> --frames <dir> [--mode production|raw]

Parity tooling only (scripts/parity/faces-compare.mjs runs it); it never ships. Needs the venv the boqo worker's
Dockerfile describes: Python 3.11 and mediapipe==0.10.18.

--mode production (the default) is what detect_faces.py does to one sampled frame: tile_windows at the production
tiling (1.5, 0.5), _process_window per window at the production confidence (0.8), boxes_from_windows at MERGE_IOU.
The frame is taken as already scaled, so `scale` is 1. --mode raw is mediapipe's own output on the whole frame,
with keypoints and without detect_faces.py's confidence re-check.

Prints one JSON document on stdout: {"frames": [{"file", "width", "height", "boxes": [...]}]}. mediapipe logs to
stderr.
"""

import argparse
import json
import os
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--boqo", required=True)
    parser.add_argument("--frames", required=True)
    parser.add_argument("--mode", choices=("production", "raw"), default="production")
    parser.add_argument("--min-confidence", type=float, default=0.8)
    parser.add_argument("--tile-max-aspect", type=float, default=1.5)
    parser.add_argument("--tile-overlap", type=float, default=0.5)
    args = parser.parse_args()

    # No __pycache__ left in the boqo checkout.
    sys.dont_write_bytecode = True
    sys.path.insert(0, os.path.join(os.path.abspath(args.boqo), "apps", "worker", "python"))
    import cv2
    import detect_faces as df
    import mediapipe as mp
    import numpy as np

    names = sorted(n for n in os.listdir(args.frames) if n.lower().endswith(".png"))
    frames = []
    with mp.solutions.face_detection.FaceDetection(
        model_selection=0, min_detection_confidence=args.min_confidence
    ) as detector:
        for name in names:
            bgr = cv2.imread(os.path.join(args.frames, name), cv2.IMREAD_COLOR)
            if bgr is None:
                raise SystemExit(f"cannot read {name}")
            rgb = np.ascontiguousarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
            height, width = rgb.shape[:2]
            if args.mode == "raw":
                boxes = []
                for d in detector.process(rgb).detections or []:
                    b = d.location_data.relative_bounding_box
                    boxes.append({
                        "x": float(b.xmin), "y": float(b.ymin),
                        "width": float(b.width), "height": float(b.height),
                        "confidence": float(d.score[0]),
                        "keypoints": [
                            {"x": float(k.x), "y": float(k.y)}
                            for k in d.location_data.relative_keypoints
                        ],
                    })
            else:
                windows = df.tile_windows(width, height, args.tile_max_aspect, args.tile_overlap)
                per_window = [
                    df._process_window(rgb, x0, win, 1.0, detector, args.min_confidence)
                    for x0, win in windows
                ]
                boxes = df.boxes_from_windows(per_window, windows, width, df.MERGE_IOU)
            frames.append({"file": name, "width": width, "height": height, "boxes": boxes})

    json.dump({"frames": frames}, sys.stdout)


if __name__ == "__main__":
    main()
