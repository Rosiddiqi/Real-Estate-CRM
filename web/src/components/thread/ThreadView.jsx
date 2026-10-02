// STUB — owned by the inbox builder. Embeddable conversation (bubbles +
// composer) used by the client card's Timeline tab.
//   <ThreadView clientId={id} embedded />   or   <ThreadView conversationId={id} />
import { EmptyState } from '../ui/kit';

export default function ThreadView() {
  return <EmptyState icon="message" title="Conversation" sub="Messages will appear here." />;
}
