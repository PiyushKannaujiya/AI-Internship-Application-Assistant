import { Link } from "react-router-dom";
import Icon from "../components/Icon.jsx";

export default function NotFoundPage() {
  return (
    <div className="notfound">
      <span className="notfound-code">404</span>
      <h1>This page went looking for an internship.</h1>
      <p>The link may be broken, or the page may have moved.</p>
      <Link to="/dashboard" className="button button-primary">
        Back to dashboard <Icon name="arrowRight" size={16} />
      </Link>
    </div>
  );
}
