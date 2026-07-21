import { createPendingPluginBatch } from "@oceanleo/plugin-runtime";

export const MEDIA_PLUGIN_BATCH = createPendingPluginBatch({
  id: "media",
  migrationBatch: 2,
  profile: "standard",
  ownerPath: "packages/migration-media",
  tenants: [
    { siteKey: "aihuman", extensionId: "digital-human-studio" },
    {
      siteKey: "image",
      extensionId: "image-workbench",
      aliases: [
        {
          sourceHost: "myselfie.oceanleo.com",
          destinationHost: "image.oceanleo.com",
        },
        {
          sourceHost: "remove.oceanleo.com",
          destinationHost: "image.oceanleo.com",
        },
      ],
    },
    {
      siteKey: "video",
      extensionId: "video-canvas",
      aliases: [
        {
          sourceHost: "studio.oceanleo.com",
          destinationHost: "video.oceanleo.com",
        },
      ],
    },
    { siteKey: "logo", extensionId: "logo-workbench" },
    { siteKey: "interior", extensionId: "interior-workbench" },
    {
      siteKey: "threed",
      extensionId: "three-dimensional-workbench",
      aliases: [
        {
          sourceHost: "threed.oceanleo.com",
          destinationHost: "3d.oceanleo.com",
        },
      ],
    },
  ],
});
