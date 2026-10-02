// STUB — replaced by the feature builder. Sheet overlay "Serena".
// Overlay contract: receives { ...props, overlayId, onClose }.
import Sheet from '../ui/Sheet';
import { EmptyState } from '../ui/kit';

export default function Overlay({ onClose }) {
  return (
    <Sheet open onClose={onClose} title="Serena">
      <EmptyState icon="sparkle" title="Serena" sub="This surface is being built." />
    </Sheet>
  );
}
