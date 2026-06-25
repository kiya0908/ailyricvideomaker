import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import * as React from "react";
import { canOpenLyricVideoOutput } from "@/features/lyric-videos/display";
import {
  defaultTemplateConfig,
  normalizeLyricLines,
} from "@/features/lyric-videos/lyrics";
import type {
  LyricLine,
  LyricVideo,
  TemplateConfig,
} from "@/features/lyric-videos/types";

export const Route = createFileRoute("/_auth/app/lyric-videos/$id")({
  component: LyricVideoDetailPage,
});

function LyricVideoDetailPage() {
  const { id } = Route.useParams();
  const [video, setVideo] = React.useState<LyricVideo | null>(null);
  const [lines, setLines] = React.useState<LyricLine[]>([]);
  const [template, setTemplate] =
    React.useState<TemplateConfig>(defaultTemplateConfig);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isRendering, setIsRendering] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void loadVideo();
  }, [id]);

  React.useEffect(() => {
    if (!video || !isJobRunningStatus(video.status)) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadVideo(false);
    }, 4000);

    return () => window.clearInterval(interval);
  }, [video?.status, id]);

  async function loadVideo(showLoading = true) {
    if (showLoading) {
      setIsLoading(true);
    }
    setError(null);
    try {
      const response = await fetch(`/api/lyric-videos/${id}`);
      if (!response.ok) {
        throw new Error("Failed to load lyric video");
      }
      const data = (await response.json()) as { video: LyricVideo };
      setVideo(data.video);
      setLines(data.video.lyricsJson.lines);
      setTemplate(data.video.templateConfig);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load lyric video");
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  }

  async function saveChanges() {
    setIsSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/lyric-videos/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lyricsJson: { lines },
          templateConfig: template,
        }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Save failed");
      }
      const data = (await response.json()) as { video: LyricVideo };
      setVideo(data.video);
      setLines(data.video.lyricsJson.lines);
      setTemplate(data.video.templateConfig);
      setMessage("Changes saved");
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Save failed");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function generateVideo() {
    setIsRendering(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await saveChanges();
      if (!saved) {
        return;
      }
      const response = await fetch(`/api/lyric-videos/${id}/render`, {
        method: "POST",
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Render failed");
      }
      await loadVideo(false);
      setMessage("Render job queued");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Render failed");
    } finally {
      setIsRendering(false);
    }
  }

  function updateLine(index: number, patch: Partial<LyricLine>) {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...patch } : line,
      ),
    );
  }

  function updateTemplate(patch: Partial<TemplateConfig>) {
    setTemplate((current) => ({ ...current, ...patch }));
  }

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading lyric video...</div>;
  }

  if (!video) {
    return <div className="p-6 text-sm text-muted-foreground">Lyric video not found.</div>;
  }

  return (
    <div className="flex flex-col gap-6 p-4 lg:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{video.title}</h1>
            <Badge variant="outline">{video.status}</Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Edit sentence-level timing, choose a template, then generate the output.
          </p>
        </div>
        {canOpenLyricVideoOutput(video) ? (
          <Button variant="outline" render={<a href={video.outputVideoUrl} target="_blank" />}>
            Open output
          </Button>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}
      {video.status === "failed" && (video.errorMessage || video.failureStage) ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {video.errorMessage ? <div>Failure reason: {video.errorMessage}</div> : null}
          {video.failureStage ? <div>Failure stage: {video.failureStage}</div> : null}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Lyrics timeline</CardTitle>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLines(normalizeLyricLines(lines))}
            >
              Normalize lyrics
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3">
            {lines.map((line, index) => (
              <div
                className="grid gap-3 rounded-md border p-3 md:grid-cols-[120px_120px_1fr]"
                key={line.id}
              >
                <div className="grid gap-2">
                  <Label htmlFor={`${line.id}-start`}>Start</Label>
                  <Input
                    id={`${line.id}-start`}
                    type="number"
                    min="0"
                    step="0.1"
                    value={line.start}
                    onChange={(event) =>
                      updateLine(index, { start: Number(event.target.value) })
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`${line.id}-end`}>End</Label>
                  <Input
                    id={`${line.id}-end`}
                    type="number"
                    min="0"
                    step="0.1"
                    value={line.end}
                    onChange={(event) =>
                      updateLine(index, { end: Number(event.target.value) })
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`${line.id}-text`}>Lyric text</Label>
                  <Input
                    id={`${line.id}-text`}
                    value={line.text}
                    onChange={(event) => updateLine(index, { text: event.target.value })}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Template</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <SelectField
              label="Background type"
              value={template.backgroundType}
              options={["color", "image"]}
              onChange={(value) =>
                updateTemplate({ backgroundType: value as TemplateConfig["backgroundType"] })
              }
            />
            <div className="grid gap-2">
              <Label htmlFor="background-value">Background value</Label>
              <Input
                id="background-value"
                type={template.backgroundType === "color" ? "color" : "url"}
                value={template.backgroundValue}
                onChange={(event) =>
                  updateTemplate({ backgroundValue: event.target.value })
                }
              />
            </div>
            <SelectField
              label="Font family"
              value={template.fontFamily}
              options={["Geist", "Arial", "Georgia", "Courier New"]}
              onChange={(value) => updateTemplate({ fontFamily: value })}
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="font-size">Font size</Label>
                <Input
                  id="font-size"
                  type="number"
                  min="12"
                  max="160"
                  value={template.fontSize}
                  onChange={(event) =>
                    updateTemplate({ fontSize: Number(event.target.value) })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="font-color">Font color</Label>
                <Input
                  id="font-color"
                  type="color"
                  value={template.fontColor}
                  onChange={(event) => updateTemplate({ fontColor: event.target.value })}
                />
              </div>
            </div>
            <SelectField
              label="Animation"
              value={template.animationStyle}
              options={["fade", "karaoke", "scroll"]}
              onChange={(value) =>
                updateTemplate({ animationStyle: value as TemplateConfig["animationStyle"] })
              }
            />
            <SelectField
              label="Aspect ratio"
              value={template.aspectRatio}
              options={["16:9", "9:16", "1:1"]}
              onChange={(value) =>
                updateTemplate({ aspectRatio: value as TemplateConfig["aspectRatio"] })
              }
            />
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-3 rounded-md border bg-background p-4 md:flex-row md:items-center md:justify-between">
        <div className="text-muted-foreground text-sm">
          {canOpenLyricVideoOutput(video)
            ? "Output is ready. Regenerate after edits if needed."
            : "Save edits before rendering a video."}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={saveChanges} disabled={isSaving || isRendering}>
            {isSaving ? "Saving..." : "Save changes"}
          </Button>
          <Button onClick={generateVideo} disabled={isRendering || isSaving}>
            {isRendering ? "Generating..." : "Generate video"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function isJobRunningStatus(status: LyricVideo["status"]) {
  return status === "uploaded" || status === "transcribing" || status === "rendering";
}

function SelectField(props: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const id = props.label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{props.label}</Label>
      <select
        id={id}
        className="border-input bg-background h-9 rounded-md border px-3 text-sm"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {props.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}
