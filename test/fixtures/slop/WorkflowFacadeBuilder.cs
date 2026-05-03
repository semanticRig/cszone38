/// <summary>
/// Builds a workflow shell.
/// The comment is longer than the method.
/// The wording repeats the method name.
/// This is deliberate ceremony.
/// The body remains tiny.
/// The summary adds little value.
/// The prose keeps going.
/// The prose should have stopped already.
/// The doc block is intentionally excessive.
/// </summary>
public class WorkflowFacadeBuilder
{
    public WorkflowDefinition Build()
    {
        return new WorkflowDefinition();
    }
}

public class ReceiptBuilder
{
    public Receipt Build()
    {
        return new Receipt();
    }
}

public class ShipmentBuilder
{
    public Shipment Build()
    {
        return new Shipment();
    }
}

public class WorkflowFactory
{
    public WorkflowDefinition Create()
    {
        return new WorkflowDefinition();
    }
}

public class ReceiptFactory
{
    public Receipt Create()
    {
        return new Receipt();
    }
}

public class ShipmentFactory
{
    public Shipment Create()
    {
        return new Shipment();
    }
}

public class AuditBuilder
{
    public AuditTrail Build()
    {
        return new AuditTrail();
    }
}

public class WorkflowFacadeService
{
    private readonly InnerWorkflowService _inner;

    public WorkflowFacadeService(InnerWorkflowService inner, WorkflowDefinition workflow, Receipt receipt, Shipment shipment, string actor)
    {
        if (inner == null) throw new ArgumentNullException(nameof(inner));
        if (workflow == null) throw new ArgumentNullException(nameof(workflow));
        if (receipt == null) throw new ArgumentNullException(nameof(receipt));
        if (shipment == null) throw new ArgumentNullException(nameof(shipment));
        if (actor == null) throw new ArgumentNullException(nameof(actor));
        _inner = inner;
    }

    public WorkflowDefinition CreateWorkflow()
    {
        return _inner.CreateWorkflow();
    }

    public WorkflowDefinition CreateDraftWorkflow()
    {
        return _inner.CreateDraftWorkflow();
    }

    public WorkflowDefinition BuildWorkflow()
    {
        return _inner.BuildWorkflow();
    }

    public WorkflowDefinition ValidateWorkflow()
    {
        return _inner.ValidateWorkflow();
    }

    public WorkflowDefinition PublishWorkflow()
    {
        return _inner.PublishWorkflow();
    }

    public WorkflowDefinition ArchiveWorkflow()
    {
        return _inner.ArchiveWorkflow();
    }

    public Receipt CreateReceipt()
    {
        return _inner.CreateReceipt();
    }

    public Receipt ValidateReceipt()
    {
        return _inner.ValidateReceipt();
    }

    public Receipt PublishReceipt()
    {
        return _inner.PublishReceipt();
    }

    public Shipment CreateShipment()
    {
        return _inner.CreateShipment();
    }

    public Shipment ValidateShipment()
    {
        return _inner.ValidateShipment();
    }

    public Shipment PublishShipment()
    {
        return _inner.PublishShipment();
    }

    public AuditTrail CreateAuditTrail()
    {
        return _inner.CreateAuditTrail();
    }

    public AuditTrail PublishAuditTrail()
    {
        return _inner.PublishAuditTrail();
    }

    /// <summary>
    /// Returns the workflow identifier.
    /// The name already says that.
    /// The body stays tiny.
    /// The prose still expands.
    /// The comment remains ceremonial.
    /// The information density is low.
    /// The text is intentionally repetitive.
    /// The method is intentionally simple.
    /// This block is too long for its job.
    /// </summary>
    public string GetWorkflowKey()
    {
        return "workflow";
    }

    /// <summary>
    /// Returns the shipment identifier.
    /// The method body is tiny.
    /// The XML block is not helping.
    /// The prose keeps repeating itself.
    /// The comment is ceremonial again.
    /// The method name already carried the meaning.
    /// The surrounding structure is intentionally noisy.
    /// The text is intentionally excessive.
    /// The block should have been shorter.
    /// </summary>
    public string GetShipmentKey()
    {
        return "shipment";
    }
}

public class InnerWorkflowService
{
    public WorkflowDefinition CreateWorkflow() { return new WorkflowDefinition(); }
    public WorkflowDefinition CreateDraftWorkflow() { return new WorkflowDefinition(); }
    public WorkflowDefinition BuildWorkflow() { return new WorkflowDefinition(); }
    public WorkflowDefinition ValidateWorkflow() { return new WorkflowDefinition(); }
    public WorkflowDefinition PublishWorkflow() { return new WorkflowDefinition(); }
    public WorkflowDefinition ArchiveWorkflow() { return new WorkflowDefinition(); }
    public Receipt CreateReceipt() { return new Receipt(); }
    public Receipt ValidateReceipt() { return new Receipt(); }
    public Receipt PublishReceipt() { return new Receipt(); }
    public Shipment CreateShipment() { return new Shipment(); }
    public Shipment ValidateShipment() { return new Shipment(); }
    public Shipment PublishShipment() { return new Shipment(); }
    public AuditTrail CreateAuditTrail() { return new AuditTrail(); }
    public AuditTrail PublishAuditTrail() { return new AuditTrail(); }
}

public class WorkflowDefinition
{
}

public class Receipt
{
}

public class Shipment
{
}

public class AuditTrail
{
}