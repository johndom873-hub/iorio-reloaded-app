import { Link, useLocation } from "react-router-dom";
import { IconMapOff } from "@tabler/icons-react";

// Any URL that matches no route inside the app shell, so an old bookmark
// (a retired screen) lands on a branded page with a way back instead of a
// blank body.
export function NotFoundPage() {
  const location = useLocation();
  return (
    <div className="empty iorio-not-found">
      <div className="empty-icon">
        <IconMapOff size={48} stroke={1.5} />
      </div>
      <p className="empty-title">Page not found</p>
      <p className="empty-subtitle text-secondary">
        <span className="font-monospace">{location.pathname}</span> isn't a page in Iorio. It may have been retired or moved.
      </p>
      <div className="empty-action">
        <Link to="/" className="btn btn-primary">
          Go to the Dashboard
        </Link>
      </div>
    </div>
  );
}
