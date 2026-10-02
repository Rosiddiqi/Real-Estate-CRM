// STUB — replaced by the feature builder. Sheet overlay "Pay Plan".
// Overlay contract: receives { ...props, overlayId, onClose }.
import Sheet from '../ui/Sheet';
import { EmptyState } from '../ui/kit';

export default function Overlay({ onClose }) {
  return (
    <Sheet open onClose={onClose} title="Pay Plan">
      <EmptyState icon="sparkle" title="Pay Plan" sub="This surface is being built." />
    </Sheet>
  );
}
