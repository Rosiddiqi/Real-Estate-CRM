// The agent's own assistant — the one they named and gave a personality in
// the assistant builder (RevMatch: every user builds their AI). Every
// user-facing mention of the assistant goes through here; never hard-code a
// name in the UI.
//
//   const { name } = useAssistant();   // "Ava", "Serena", "Max"…
import { useAuth } from './useAuth';
import { BRAND } from '../brand';

export function assistantNameOf(user) {
  const n = user && user.aiPreferences && user.aiPreferences.aiName;
  return (typeof n === 'string' && n.trim()) || BRAND.assistantName;
}

export function useAssistant() {
  const { user } = useAuth();
  const p = (user && user.aiPreferences) || {};
  return {
    name: assistantNameOf(user),
    personalityId: p.aiPersonalityId || null,
    personality: p.aiPersonality || '',
    built: !!(p.aiName && String(p.aiName).trim()),
  };
}

export default useAssistant;
