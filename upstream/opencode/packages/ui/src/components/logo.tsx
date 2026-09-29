import { type ComponentProps } from "solid-js"
import mark from "../assets/pixelcrabs-open.png"

export const Mark = (props: { class?: string }) => (
  <svg data-component="logo-mark" class={props.class} viewBox="0 0 256 256" role="img" aria-label="PixelCrabs Open">
    <image href={mark} width="256" height="256" />
  </svg>
)

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => (
  <svg ref={props.ref} data-component="logo-splash" class={props.class} viewBox="0 0 256 256" role="img" aria-label="PixelCrabs Open">
    <image href={mark} width="256" height="256" />
  </svg>
)

export const Logo = (props: { class?: string }) => (
  <svg class={props.class} viewBox="0 0 310 48" role="img" aria-label="PixelCrabs Open">
    <image href={mark} width="48" height="48" />
    <text x="60" y="31" font-family="system-ui, sans-serif" font-size="25" font-weight="650" fill="currentColor">PixelCrabs Open</text>
  </svg>
)
