import { LayoutGrid } from "lucide-react";
import { FILTERS, useEditorStore } from "../../store/editorStore";

export default function Inspector() {
  const project = useEditorStore((s) => s.project);
  const selectedId = useEditorStore((s) => s.selectedId);
  const updateClip = useEditorStore((s) => s.updateClip);
  const setAspect = useEditorStore((s) => s.setAspect);
  const clip = project?.clips.find((c) => c.id === selectedId);

  const canvasSelect = project && (
    <div className="prop">
      <label>Canvas</label>
      <select value={project.aspect} onChange={(e) => setAspect(e.target.value as typeof project.aspect)}>
        <option value="9:16">9:16 Vertical</option>
        <option value="16:9">16:9 Landscape</option>
        <option value="1:1">1:1 Square</option>
        <option value="4:5">4:5 Portrait</option>
      </select>
    </div>
  );

  if (!clip) {
    return (
      <aside className="inspector">
        {canvasSelect}
        <div className="inspector-empty">
          <LayoutGrid size={36} />
          <div>Select to Edit</div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="inspector">
      {canvasSelect}
      <h3 style={{ marginBottom: 16 }}>{clip.name}</h3>
      {(clip.type === "text") && (
        <>
          <div className="field">
            <label>Text</label>
            <textarea value={clip.text} onChange={(e) => updateClip(clip.id, { text: e.target.value })} />
          </div>
          <div className="row">
            <div className="field">
              <label>Color</label>
              <input type="color" value={clip.color} onChange={(e) => updateClip(clip.id, { color: e.target.value })} />
            </div>
            <div className="field">
              <label>Stroke</label>
              <input type="color" value={clip.stroke} onChange={(e) => updateClip(clip.id, { stroke: e.target.value })} />
            </div>
          </div>
          <Slider label="Size" value={clip.fontSize} min={16} max={140} onChange={(fontSize) => updateClip(clip.id, { fontSize })} />
        </>
      )}
      {clip.type === "shape" && (
        <div className="field">
          <label>Fill</label>
          <input type="color" value={clip.fill} onChange={(e) => updateClip(clip.id, { fill: e.target.value })} />
        </div>
      )}
      <Slider label="Volume" value={clip.volume} min={0} max={1} step={0.05} onChange={(volume) => updateClip(clip.id, { volume })} />
      <Slider label="Speed" value={clip.speed} min={0.25} max={4} step={0.05} onChange={(speed) => updateClip(clip.id, { speed })} />
      <Slider label="Opacity" value={clip.opacity} min={0} max={1} step={0.05} onChange={(opacity) => updateClip(clip.id, { opacity })} />
      <Slider label="Scale" value={clip.scale} min={0.1} max={3} step={0.05} onChange={(scale) => updateClip(clip.id, { scale })} />
      <Slider label="Position X" value={clip.x} min={-400} max={400} onChange={(x) => updateClip(clip.id, { x })} />
      <Slider label="Position Y" value={clip.y} min={-400} max={400} onChange={(y) => updateClip(clip.id, { y })} />
      <Slider label="Rotate" value={clip.rotation} min={-180} max={180} onChange={(rotation) => updateClip(clip.id, { rotation })} />
      <Slider label="Brightness" value={clip.brightness} min={0.2} max={2} step={0.05} onChange={(brightness) => updateClip(clip.id, { brightness })} />
      <Slider label="Contrast" value={clip.contrast} min={0.2} max={2} step={0.05} onChange={(contrast) => updateClip(clip.id, { contrast })} />
      <Slider label="Saturate" value={clip.saturate} min={0} max={2} step={0.05} onChange={(saturate) => updateClip(clip.id, { saturate })} />
      <Slider label="Blur" value={clip.blur} min={0} max={12} step={0.5} onChange={(blur) => updateClip(clip.id, { blur })} />
      <Slider label="Fade in" value={clip.fadeIn} min={0} max={3} step={0.1} onChange={(fadeIn) => updateClip(clip.id, { fadeIn })} />
      <Slider label="Fade out" value={clip.fadeOut} min={0} max={3} step={0.1} onChange={(fadeOut) => updateClip(clip.id, { fadeOut })} />
      <div className="field">
        <label>Filter</label>
        <div className="chips">
          {FILTERS.map((filter) => (
            <button
              key={filter.id}
              className={`chip ${clip.filterPreset === filter.id ? "active" : ""}`}
              onClick={() => updateClip(clip.id, { filterPreset: filter.id })}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="prop">
      <label>
        <span>{label}</span>
        <span>{Number(value.toFixed(2))}</span>
      </label>
      <input
        className="range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
