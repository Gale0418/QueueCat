import { expect, it } from "vitest";
import { previewManagerUrl } from "../src/ui/client";

it.each(["/entries/", "/", "/queuecat/entries/"])(
  "keeps preview navigation in the current %s entry directory",
  (directory) => {
    const popup = `http://127.0.0.1:5173${directory}popup.html?preview=1#old`;
    expect(previewManagerUrl(popup)).toBe(
      `http://127.0.0.1:5173${directory}manager.html?preview=1`,
    );
    expect(previewManagerUrl(popup, "settings")).toBe(
      `http://127.0.0.1:5173${directory}manager.html?preview=1#settings`,
    );
  },
);
