// The agent's time zone (user → workspace → device), kept in sync with the
// time helpers so plain functions render in the same zone as the server.
import { useAuth } from '../../hooks/useAuth';
import { agentTz, setAgentTz } from './time';

export default function useAgentTz() {
  const { user, workspace } = useAuth() || {};
  const tz = (user && user.timezone) || (workspace && workspace.timezone) || agentTz();
  setAgentTz(tz);
  return tz;
}
