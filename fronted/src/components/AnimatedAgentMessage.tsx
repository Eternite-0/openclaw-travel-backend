import { useState, useEffect, memo } from 'react';
import { AGENT_MESSAGES } from '../constants';

export const AnimatedAgentMessage = memo(function AnimatedAgentMessage({ agentName }: { agentName: string }) {
  const msgs = AGENT_MESSAGES[agentName] ?? ['正在处理中...', '稍等片刻...'];
  const [idx, setIdx] = useState(0);
  const [show, setShow] = useState(true);

  useEffect(() => {
    const iv = setInterval(() => {
      setShow(false);
      setTimeout(() => {
        setIdx(i => (i + 1) % msgs.length);
        setShow(true);
      }, 250);
    }, 2200);
    return () => clearInterval(iv);
  }, [msgs.length]);

  return (
    <span
      className="text-[11px] text-primary/70 font-normal transition-opacity duration-250 block mt-0.5"
      style={{ opacity: show ? 1 : 0 }}
    >
      {msgs[idx]}
    </span>
  );
});
