import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import * as React from "react";
import type { LyricVideo } from "@/features/lyric-videos/types";

export const Route = createFileRoute("/_auth/app/lyric-videos")({
  component: LyricVideosPage,
});

function LyricVideosPage() {
  const navigate = useNavigate();
  const [videos, setVideos] = React.useState<LyricVideo[]>([]);
  const [title, setTitle] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isUploading, setIsUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void loadVideos();
  }, []);

  async function loadVideos() {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/lyric-videos");
      if (!response.ok) {
        throw new Error("Failed to load lyric videos");
      }
      const data = (await response.json()) as { videos: LyricVideo[] };
      setVideos(data.videos);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load lyric videos");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("Please choose an audio file first");
      return;
    }

    setIsUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      if (title.trim()) {
        formData.set("title", title.trim());
      }

      const response = await fetch("/api/lyric-videos", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Upload failed");
      }
      const data = (await response.json()) as { video: LyricVideo };
      await navigate({ to: "/app/lyric-videos/$id", params: { id: data.video.id } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Lyric Videos</h1>
        <p className="text-muted-foreground text-sm">
          Upload audio, edit synced lyrics, and generate a downloadable lyric video.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Create from audio</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-[1fr_1fr_auto]" onSubmit={handleUpload}>
            <div className="grid gap-2">
              <Label htmlFor="lyric-video-title">Title</Label>
              <Input
                id="lyric-video-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Midnight chorus"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="lyric-video-file">Audio file</Label>
              <Input
                id="lyric-video-file"
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.aac"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>
            <Button className="self-end" type="submit" disabled={isUploading}>
              {isUploading ? "Uploading..." : "Upload"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your lyric videos</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-muted-foreground text-sm">Loading lyric videos...</div>
          ) : videos.length === 0 ? (
            <div className="text-muted-foreground text-sm">No lyric videos yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {videos.map((video) => (
                  <TableRow key={video.id}>
                    <TableCell className="font-medium">{video.title}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{video.status}</Badge>
                    </TableCell>
                    <TableCell>{new Date(video.createdAt).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          navigate({
                            to: "/app/lyric-videos/$id",
                            params: { id: video.id },
                          })
                        }
                      >
                        {video.status === "ready" ? "View" : "Edit"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
