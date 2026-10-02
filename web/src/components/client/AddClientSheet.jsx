// STUB — replaced by the feature builder. Sheet overlay "New Client".
// Overlay contract: receives { ...props, overlayId, onClose }.
import Sheet from '../ui/Sheet';
import { EmptyState } from '../ui/kit';

export default function Overlay({ onClose }) {
  return (
    <Sheet open onClose={onClose} title="New Client">
      <EmptyState icon="sparkle" title="New Client" sub="This surface is being built." />
    </Sheet>
  );
}
