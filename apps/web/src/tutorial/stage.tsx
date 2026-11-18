import { useEffect, useId, useState } from "react";
import { useProduct } from "../lib/session.tsx";
import { BrandMark } from "../shell/brand.tsx";
import { useScheme } from "../shell/theme.ts";
import { Button, Glyph, IconButton } from "../ui/index.tsx";
import { prefersReducedMotion } from "../ui/media.ts";
import { TUTORIAL, type AgentItem } from "./content/index.ts";
import { ProgressBar } from "./layer.tsx";
import { useTutorial } from "./provider.tsx";
import { lineText, PLACES, type Place } from "./stops.ts";

/**
 * The agent stage: most of the screen, an agent at work, played back. On the left the person's own
 * chat with their agent, drawn in the opposite theme to the app's so it reads as another application;
 * on the right a small WhatBuild, in the app's own theme, whose pages fill in as the agent calls each
 * MCP tool; below, the four pages with the tools that write them, each lit as it is written. It loops,
 * and Replay starts it again. With reduced motion it shows its last frame.
 */

const ORDER: Place[] = ["idea", "evidence", "exploration", "story"];
const HEADS: Record<Place, string> = { idea: "Outcomes", evidence: "Sources", exploration: "Mockups", story: "Story pages" };
const EMPTY: Record<Place, string> = { idea: "No outcomes yet", evidence: "No sources yet", exploration: "No mockups yet", story: "No Story pages yet" };

type Message = { kind: "you"; text: string } | { kind: "agent"; text: string } | { kind: "tool"; tool: string; act: string; done: boolean };

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function MiniItem({ item, product, fresh }: { item: AgentItem; product: string; fresh: boolean }) {
  const by = (
    <span className="mini-by">
      <Glyph name="bot" size="sm" />
      Added by your agent · just now
    </span>
  );
  const cls = `mini-card mini-${item.kind}`;
  if (item.kind === "source")
    return (
      <div className={cls} data-new={fresh ? "" : undefined}>
        <span className="mini-thumb">
          <i />
          <i />
          <i />
        </span>
        <span className="mini-src">
          <b>{item.title}</b>
          <span className="mini-tags">
            {item.tags.map((tag) => (
              <i key={tag}>{tag}</i>
            ))}
          </span>
          {by}
        </span>
      </div>
    );
  if (item.kind === "outcome")
    return (
      <div className={cls} data-new={fresh ? "" : undefined}>
        <b className="mini-o">
          <span className="mini-o-num num">1</span>
          {item.title}
        </b>
        <div className="mini-bars">
          <span>Today</span>
          <i className="mini-bar mini-bar-today" />
          <em>{item.today}</em>
          <span>Success</span>
          <i className="mini-bar mini-bar-goal" />
          <em className="mini-goal">{item.success}</em>
        </div>
        {by}
      </div>
    );
  if (item.kind === "mockup")
    return (
      <div className={cls} data-new={fresh ? "" : undefined}>
        <div className="mini-pages">
          <i>
            <s />
            <s />
            <s />
          </i>
          <i className="mini-phone">
            <s />
            <s />
          </i>
        </div>
        <b>{item.title}</b>
        <span className="mini-meta">{item.meta}</span>
        {by}
      </div>
    );
  return (
    <div className={cls} data-new={fresh ? "" : undefined}>
      <span className="mini-kicker">{item.kicker.replace("{product}", product)}</span>
      <b>{item.title}</b>
      <p>{item.text}</p>
      {by}
    </div>
  );
}

export function AgentStage() {
  const t = useTutorial()!;
  const { product } = useProduct();
  const scheme = useScheme();
  const script = TUTORIAL.agents;
  const prompt = script.prompt.replace("{product}", product.name);
  const titleId = useId();
  const leadId = useId();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [filled, setFilled] = useState<Partial<Record<Place, { item: AgentItem; fresh: boolean }>>>({});
  const [on, setOn] = useState<Place | null>(null);
  const [run, setRun] = useState(0);
  const { at, stops, current } = t;
  const last = at === stops.length - 1;

  useEffect(() => {
    let alive = true;
    const finalFrame = () => {
      const all: Message[] = [{ kind: "you", text: prompt }];
      for (const b of script.beats) all.push({ kind: "agent", text: b.say }, { kind: "tool", tool: b.tool, act: b.act, done: true });
      all.push({ kind: "agent", text: script.done });
      setInput("");
      setMessages(all);
      setFilled(Object.fromEntries(script.beats.map((b) => [b.place, { item: b.item, fresh: false }])));
      setOn(null);
    };
    const play = async () => {
      setMessages([]);
      setInput("");
      setFilled({});
      setOn(null);
      if (prefersReducedMotion()) return finalFrame();
      await wait(700);
      for (let i = 2; i <= prompt.length + 1; i += 2) {
        if (!alive) return;
        setInput(prompt.slice(0, i));
        await wait(24);
      }
      await wait(380);
      if (!alive) return;
      setInput("");
      setMessages([{ kind: "you", text: prompt }]);
      await wait(700);
      for (const b of script.beats) {
        if (!alive) return;
        setMessages((m) => [...m, { kind: "agent", text: b.say }]);
        await wait(500);
        if (!alive) return;
        setMessages((m) => [...m, { kind: "tool", tool: b.tool, act: b.act, done: false }]);
        await wait(800);
        if (!alive) return;
        setMessages((m) => m.map((x, i) => (i === m.length - 1 && x.kind === "tool" ? { ...x, done: true } : x)));
        setFilled((f) => ({ ...f, [b.place]: { item: b.item, fresh: true } }));
        setOn(b.place);
        await wait(1700);
      }
      if (!alive) return;
      setOn(null);
      setMessages((m) => [...m, { kind: "agent", text: script.done }]);
      await wait(5200);
      if (alive) void play();
    };
    void play();
    return () => {
      alive = false;
    };
  }, [run, prompt, script]);

  // The chat is another application: the opposite theme to the app's.
  const chatTheme = scheme === "dark" ? "theme-light" : "theme-dark";
  return (
    <div
      ref={(el) => {
        t.cardRef.current = el;
      }}
      className="tut-card tut-stage"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={leadId}
    >
      <IconButton className="tut-x" size="sm" icon="x" label="Close the tutorial" title="Close the tutorial (Esc)" onClick={t.later} data-later="" />
      <header className="tut-stage-head">
        <ProgressBar at={at} count={stops.length} />
        <p className="tut-count num">
          {at + 1} of {stops.length}
        </p>
        <h2 className="tut-stage-title" id={titleId}>
          {current?.title}
        </h2>
        <p className="tut-stage-lead" id={leadId}>
          {current ? lineText(current.line) : null}
        </p>
      </header>
      <div className="tut-stage-show">
        <div className={`tut-chat ${chatTheme}`} aria-hidden="true">
          <div className="tut-chat-head">
            <Glyph name="bot" />
            <b>{script.agent}</b>
            <span className="tut-chat-mcp">
              <i />
              {script.connected}
            </span>
          </div>
          <div className="tut-chat-body">
            {messages.map((m, i) =>
              m.kind === "you" ? (
                <div key={i} className="msg msg-you">
                  {m.text}
                </div>
              ) : m.kind === "agent" ? (
                <div key={i} className="msg msg-agent">
                  <Glyph name="bot" />
                  <span>{m.text}</span>
                </div>
              ) : (
                <div key={i} className="msg msg-tool" data-done={m.done ? "" : undefined}>
                  {m.done ? <Glyph name="check" size="sm" /> : <span className="msg-spin" />}
                  <b>whatbuild</b> {m.tool} <em>{m.act}</em>
                </div>
              ),
            )}
          </div>
          <div className="tut-chat-input">
            <span data-empty={input ? undefined : ""}>{input || script.placeholder}</span>
            <i className="tut-caret" />
          </div>
        </div>
        <div className="mini" aria-hidden="true">
          <div className="mini-panel">
            <div className="mini-brand">
              <BrandMark size={14} />
              <b>WhatBuild</b>
            </div>
            <p className="mini-product">{product.name}</p>
            <ul className="mini-nav">
              {ORDER.map((p) => (
                <li key={p} aria-current={on === p ? "true" : undefined}>
                  <Glyph name={PLACES[p].icon} size="sm" />
                  <span>{PLACES[p].label}</span>
                  <i className="num" data-bump={filled[p]?.fresh && on === p ? "" : undefined}>
                    {filled[p] ? 1 : 0}
                  </i>
                </li>
              ))}
            </ul>
          </div>
          <div className="mini-main">
            {ORDER.map((p) => (
              <section key={p} className="mini-sec" data-on={on === p ? "" : undefined}>
                <p className="mini-h">
                  <Glyph name={PLACES[p].icon} size="sm" />
                  {HEADS[p]} <span className="num">{filled[p] ? 1 : 0}</span>
                </p>
                {filled[p] ? <MiniItem item={filled[p]!.item} product={product.name} fresh={filled[p]!.fresh} /> : <p className="mini-empty">{EMPTY[p]}</p>}
              </section>
            ))}
          </div>
        </div>
      </div>
      <ul className="tut-stage-places">
        {ORDER.map((p) => (
          <li key={p} data-on={on === p ? "" : undefined}>
            <Glyph name={PLACES[p].icon} />
            <b>{PLACES[p].label}</b>
            <code>{script.tools[p]}</code>
          </li>
        ))}
      </ul>
      <footer className="tut-foot tut-stage-foot">
        {t.off ? null : (
          <Button size="sm" variant="quiet" className="tut-later" onClick={t.turnOff}>
            Turn off tutorials
          </Button>
        )}
        <span className="tut-stage-note">
          <Glyph name="signpost" size="sm" />
          {script.note}
        </span>
        <Button size="sm" icon="rotate-ccw" onClick={() => setRun((n) => n + 1)}>
          Replay
        </Button>
        {at > 0 ? (
          <Button size="sm" onClick={() => t.go(at - 1)}>
            Back
          </Button>
        ) : null}
        <Button size="sm" variant="primary" onClick={() => (last ? t.finish(false) : t.go(at + 1))} data-primary="">
          {last ? "Finish" : "Next"}
        </Button>
      </footer>
    </div>
  );
}

