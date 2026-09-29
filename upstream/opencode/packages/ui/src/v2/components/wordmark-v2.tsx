import { type ComponentProps } from "solid-js"
import mark from "../../assets/pixelcrabs-open.png"

export function WordmarkV2(props: Pick<ComponentProps<"svg">, "class">) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 129" class={props.class} role="img" aria-label="PixelCrabs Open">
      <image href={mark} x="8" y="8" width="112" height="112" />
      <text x="148" y="76" font-family="system-ui, sans-serif" font-size="64" font-weight="650" fill="currentColor" opacity="0.65">PixelCrabs</text>
      <text x="151" y="110" font-family="system-ui, sans-serif" font-size="18" letter-spacing="4" fill="currentColor" opacity="0.55">OPEN SOURCE</text>
    </svg>
  )
}
