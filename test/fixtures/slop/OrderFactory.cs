public class OrderFactory
{
    public Order Create()
    {
        return new Order();
    }

    public Order CreateDefault()
    {
        return new Order();
    }
}

public class Order
{
}