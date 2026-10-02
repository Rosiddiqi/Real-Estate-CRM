// STUB — replaced by the feature builder. Push-panel overlay "Book of Business".
// Overlay contract: receives { ...props, overlayId, onClose }.
import PushPanel from '../../components/ui/PushPanel';
import { EmptyState } from '../../components/ui/kit';

export default function Overlay({ onClose }) {
  return (
    <PushPanel onClose={onClose} title="Book of Business">
      <EmptyState icon="sparkle" title="Book of Business" sub="This surface is being built." />
    </PushPanel>
  );
}
