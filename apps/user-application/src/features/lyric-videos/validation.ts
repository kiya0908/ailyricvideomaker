import { z } from "zod";

export const LyricLineSchema = z.object({
  id: z.string().min(1),
  start: z.number().finite().min(0),
  end: z.number().finite().min(0),
  text: z.string(),
});

export const LyricsJsonSchema = z.object({
  lines: z.array(LyricLineSchema),
});

export const TemplateConfigSchema = z.object({
  backgroundType: z.enum(["color", "image"]),
  backgroundValue: z.string().min(1),
  fontFamily: z.string().min(1),
  fontColor: z.string().min(1),
  fontSize: z.number().finite().min(12).max(160),
  animationStyle: z.enum(["fade", "karaoke", "scroll"]),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
});

export const UpdateLyricVideoSchema = z
  .object({
    lyricsJson: LyricsJsonSchema.optional(),
    templateConfig: TemplateConfigSchema.optional(),
  })
  .refine((value) => value.lyricsJson || value.templateConfig, {
    message: "lyricsJson or templateConfig is required",
  });
