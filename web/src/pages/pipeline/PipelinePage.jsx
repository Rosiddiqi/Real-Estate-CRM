// STUB — replaced by the feature builder. Push-panel overlay "Pipeline".
// Overlay contract: receives { ...props, overlayId, onClose }.
import PushPanel from '../../components/ui/PushPanel';
import { EmptyState } from '../../components/ui/kit';

export default function Overlay({ onClose }) {
  return (
    <PushPanel onClose={onClose} title="Pipeline">
      <EmptyState icon="sparkle" title="Pipeline" sub="This surface is being built." />
    </PushPanel>
  );
}
